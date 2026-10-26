-- Stage 2: AFTER prepare + migration script --apply. Blocks Firebase tokens.
-- Replace YOUR_SUPABASE_URL with the exact project's HTTPS URL, no trailing slash.
BEGIN;
CREATE TABLE IF NOT EXISTS app_private.supabase_auth_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),issuer text NOT NULL);
INSERT INTO app_private.supabase_auth_config VALUES(true,'YOUR_SUPABASE_URL/auth/v1') ON CONFLICT(singleton) DO NOTHING;
REVOKE ALL ON app_private.supabase_auth_config FROM PUBLIC,anon,authenticated;
-- The legacy verification trigger runs before claim_username. Initialize the
-- app-account FK first, without legacy email-based ownership reassignment.
CREATE OR REPLACE FUNCTION app_private.initialize_user(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN RETURN; END IF;
 INSERT INTO app_private.app_accounts(id) VALUES(p_user) ON CONFLICT(id) DO NOTHING;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM app_private.supabase_auth_config WHERE issuer NOT LIKE 'https://%/auth/v1') THEN RAISE EXCEPTION 'Set YOUR_SUPABASE_URL'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.firebase_accounts f LEFT JOIN auth.users u ON u.id=f.app_user_id
   LEFT JOIN app_private.supabase_usernames n ON n.user_id=f.app_user_id
   WHERE u.id IS NULL OR u.email_confirmed_at IS NULL OR n.user_id IS NULL) THEN RAISE EXCEPTION 'Migrate every mapped account before cutover'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.current_app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id FROM auth.users u JOIN app_private.supabase_auth_config c ON c.singleton
 WHERE u.id::text=auth.jwt()->>'sub' AND u.email_confirmed_at IS NOT NULL
 AND auth.jwt()->>'iss'=c.issuer AND auth.jwt()->>'aud'='authenticated'
 AND auth.jwt()->>'role'='authenticated'
$$;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.username_available(p_username text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_username ~ '^[a-z][a-z0-9_]{2,23}$'
 AND p_username NOT IN ('admin','administrator','support','system','root','null','undefined','expensive')
 AND NOT EXISTS(SELECT 1 FROM app_private.supabase_usernames WHERE username=p_username)
$$;
CREATE OR REPLACE FUNCTION public.claim_username(p_username text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id();
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Verify your email and sign in'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner::text,712));
 IF EXISTS(SELECT 1 FROM app_private.supabase_usernames WHERE user_id=owner AND username=p_username) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM app_private.supabase_usernames WHERE user_id=owner) THEN RAISE EXCEPTION 'Username already set'; END IF;
 IF public.username_available(p_username) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Username unavailable'; END IF;
 INSERT INTO app_private.app_accounts(id) VALUES(owner) ON CONFLICT(id) DO NOTHING;
 INSERT INTO app_private.supabase_usernames(username,user_id) VALUES(p_username,owner);
 UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('username',p_username) WHERE id=owner;
 IF NOT EXISTS(SELECT 1 FROM public.categories WHERE user_id=owner) THEN
 INSERT INTO public.categories(user_id,name,color,sort_order) VALUES
 (owner,'food','#888888',0),(owner,'transport','#888888',1),(owner,'shopping','#888888',2),(owner,'bills','#888888',3),(owner,'other','#888888',4);
 END IF;
END $$;
-- Private username resolution: only the server can see the associated email.
CREATE OR REPLACE FUNCTION public.login_email(p_username text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.email FROM auth.users u JOIN app_private.supabase_usernames n ON n.user_id=u.id WHERE n.username=p_username AND u.email_confirmed_at IS NOT NULL
$$;
CREATE TABLE IF NOT EXISTS app_private.auth_rate_limits(key text PRIMARY KEY,started timestamptz NOT NULL,count integer NOT NULL);
REVOKE ALL ON app_private.auth_rate_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.limit_password_login(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempts integer;
BEGIN
 DELETE FROM app_private.auth_rate_limits WHERE started < now()-interval '1 day';
 INSERT INTO app_private.auth_rate_limits VALUES(p_key,now(),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_rate_limits.started < now()-interval '1 minute' THEN 1 ELSE auth_rate_limits.count+1 END,
 started=CASE WHEN auth_rate_limits.started < now()-interval '1 minute' THEN now() ELSE auth_rate_limits.started END
 RETURNING count INTO attempts;
 RETURN attempts<=15;
END $$;
REVOKE ALL ON FUNCTION public.username_available(text),public.claim_username(text),public.login_email(text),public.limit_password_login(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.login_email(text),public.limit_password_login(text) TO service_role;
-- Disable the former enrollment endpoint even if an old web deployment remains.
REVOKE EXECUTE ON FUNCTION public.enroll_firebase_user(text,text,text) FROM service_role;
COMMIT;
