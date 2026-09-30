-- Existing multi-user Expensive database. Back up before applying.
-- Replace YOUR_FIREBASE_PROJECT_ID below. Run after ios/Database/native-operations.sql.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS app_private.firebase_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), project_id text NOT NULL
);
INSERT INTO app_private.firebase_config VALUES (true, 'YOUR_FIREBASE_PROJECT_ID')
ON CONFLICT(singleton) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM app_private.firebase_config WHERE project_id !~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') THEN
    RAISE EXCEPTION 'Replace YOUR_FIREBASE_PROJECT_ID before running this migration';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='user_id') THEN
    RAISE EXCEPTION 'The existing multi-user schema with profiles.user_id is required';
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE user_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.categories WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Assign existing unowned profiles/categories to their verified legacy owner before migration';
  END IF;
END $$;

-- Snapshot the verified legacy email once. Later email changes cannot claim a second account.
CREATE TABLE IF NOT EXISTS app_private.app_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_private.app_accounts(id,legacy_email)
SELECT id, CASE WHEN email_confirmed_at IS NOT NULL THEN lower(email) END FROM auth.users
ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS app_private.firebase_accounts (
  firebase_uid text PRIMARY KEY, app_user_id uuid NOT NULL UNIQUE REFERENCES app_private.app_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.app_user_id FROM app_private.firebase_accounts a
  JOIN app_private.firebase_config c ON c.singleton
  WHERE a.firebase_uid = auth.jwt()->>'sub'
    AND auth.jwt()->>'iss' = 'https://securetoken.google.com/' || c.project_id
    AND auth.jwt()->>'aud' = c.project_id
    AND auth.jwt()->>'email_verified' = 'true'
    AND auth.jwt()->>'role' = 'authenticated'
$$;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

-- Only the trusted app server calls this, after Firebase Admin verifies the token
-- and current verified email. No client supplies an app user ID or trusted email.
CREATE OR REPLACE FUNCTION public.enroll_firebase_user(p_uid text,p_email text,p_project text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF p_uid IS NULL OR length(p_uid) NOT BETWEEN 1 AND 128 OR p_email IS NULL
    OR NOT EXISTS(SELECT 1 FROM app_private.firebase_config WHERE project_id=p_project) THEN
    RAISE EXCEPTION 'Invalid identity';
  END IF;
  -- Completed accounts use the indexed lookup without taking a lock.
  SELECT app_user_id INTO result FROM app_private.firebase_accounts WHERE firebase_uid=p_uid;
  IF FOUND THEN RETURN result; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_uid,621773));
  SELECT app_user_id INTO result FROM app_private.firebase_accounts WHERE firebase_uid=p_uid;
  IF FOUND THEN RETURN result; END IF;
  SELECT id INTO result FROM app_private.app_accounts WHERE legacy_email=lower(trim(p_email));
  IF result IS NULL THEN
    INSERT INTO app_private.app_accounts DEFAULT VALUES RETURNING id INTO result;
  END IF;
  IF EXISTS(SELECT 1 FROM app_private.firebase_accounts WHERE app_user_id=result) THEN
    RAISE EXCEPTION 'This legacy account is already linked. Contact support.';
  END IF;
  INSERT INTO app_private.firebase_accounts(firebase_uid,app_user_id) VALUES(p_uid,result);
  IF NOT EXISTS(SELECT 1 FROM public.categories WHERE user_id=result) THEN
    INSERT INTO public.categories(user_id,name,color,sort_order) VALUES
      (result,'food','#888888',0),(result,'transport','#888888',1),
      (result,'shopping','#888888',2),(result,'bills','#888888',3),(result,'other','#888888',4);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.enroll_firebase_user(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_firebase_user(text,text,text) TO service_role;

-- Preserve UUID ownership and rows; move owner foreign keys away from auth.users.
DO $$ DECLARE row record; BEGIN
  FOR row IN SELECT c.conname,c.conrelid::regclass AS tbl, a.attname
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
      AND c.conrelid IN ('public.profiles'::regclass,'public.categories'::regclass,'public.ios_tab_requests'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',row.tbl,row.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES app_private.app_accounts(id)',row.tbl,row.conname,row.attname);
  END LOOP;
END $$;
ALTER TABLE public.profiles ALTER COLUMN user_id SET DEFAULT public.current_app_user_id();
ALTER TABLE public.categories ALTER COLUMN user_id SET DEFAULT public.current_app_user_id();
ALTER TABLE public.ios_tab_requests ALTER COLUMN user_id SET DEFAULT public.current_app_user_id();

-- Replace old permissive policies, including installations with legacy open policies.
DO $$ DECLARE row record; BEGIN
  FOR row IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('profiles','categories','expenses','people','debts','profile_transfers','ios_tab_requests')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I',row.policyname,row.schemaname,row.tablename); END LOOP;
END $$;
CREATE POLICY firebase_owner ON public.profiles FOR ALL TO authenticated
  USING(user_id=(SELECT public.current_app_user_id())) WITH CHECK(user_id=(SELECT public.current_app_user_id()));
CREATE POLICY firebase_owner ON public.categories FOR ALL TO authenticated
  USING(user_id=(SELECT public.current_app_user_id())) WITH CHECK(user_id=(SELECT public.current_app_user_id()));
CREATE POLICY firebase_owner ON public.people FOR ALL TO authenticated
  USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id))
  WITH CHECK(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id));
CREATE POLICY firebase_owner ON public.expenses FOR ALL TO authenticated
  USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id))
  WITH CHECK(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id)
    AND (category_id IS NULL OR EXISTS(SELECT 1 FROM public.categories c WHERE c.id=category_id)));
CREATE POLICY firebase_owner ON public.debts FOR ALL TO authenticated
  USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id))
  WITH CHECK(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=profile_id)
    AND EXISTS(SELECT 1 FROM public.people p WHERE p.id=person_id AND p.profile_id=debts.profile_id));
CREATE POLICY firebase_owner ON public.profile_transfers FOR ALL TO authenticated
  USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=from_profile)
    AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=to_profile))
  WITH CHECK(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=from_profile)
    AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=to_profile));
CREATE POLICY firebase_owner ON public.ios_tab_requests FOR ALL TO authenticated
  USING(user_id=(SELECT public.current_app_user_id())) WITH CHECK(user_id=(SELECT public.current_app_user_id()));

-- Existing money functions keep their transaction logic, using mapped UUIDs.
DO $$ DECLARE row record; definition text; BEGIN
  FOR row IN SELECT p.oid,p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('add_tab','settle_tab','transfer_money','ios_add_expense','ios_delete_expense','ios_move_expense','ios_add_tabs')
  LOOP
    definition:=pg_get_functiondef(row.oid);
    definition:=regexp_replace(definition,'auth\.uid\(\s*\)','public.current_app_user_id()','g');
    EXECUTE definition;
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER',row.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',row.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',row.signature);
  END LOOP;
  FOR row IN SELECT unnest(ARRAY['profiles','categories','expenses','people','debts','profile_transfers','ios_tab_requests']) AS name LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',row.name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon',row.name);
  END LOOP;
END $$;
COMMIT;
