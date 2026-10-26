-- Private trips. Requires Supabase auth cutover and expense upgrades.
BEGIN;
CREATE TABLE IF NOT EXISTS app_private.trip_deletions (
 user_id uuid NOT NULL REFERENCES app_private.app_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('trip','expense')),
 PRIMARY KEY(id,kind)
);
REVOKE ALL ON app_private.trip_deletions FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.trips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL DEFAULT public.current_app_user_id() REFERENCES app_private.app_accounts(id),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 budget numeric NOT NULL DEFAULT 0 CHECK(budget>=0 AND budget<10000000000 AND budget=round(budget,2)),
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.trip_members (
 trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
 person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
 PRIMARY KEY(trip_id,person_id)
);
CREATE TABLE IF NOT EXISTS public.trip_entries (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
 reason text NOT NULL, amount numeric NOT NULL, payer uuid REFERENCES public.people(id) ON DELETE SET NULL,
 shares jsonb NOT NULL, category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), request jsonb NOT NULL
);
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL;
ALTER TABLE public.trip_entries ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.trip_entries ADD COLUMN IF NOT EXISTS ledger_expenses jsonb;
ALTER TABLE public.trip_entries ADD COLUMN IF NOT EXISTS ledger_debts jsonb;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_owner ON public.trips;
CREATE POLICY trip_owner ON public.trips FOR SELECT TO authenticated USING(user_id=(SELECT public.current_app_user_id()));
DROP POLICY IF EXISTS trip_owner ON public.trip_members;
CREATE POLICY trip_owner ON public.trip_members FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.user_id=(SELECT public.current_app_user_id())));
DROP POLICY IF EXISTS trip_owner ON public.trip_entries;
CREATE POLICY trip_owner ON public.trip_entries FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.user_id=(SELECT public.current_app_user_id())));
REVOKE ALL ON public.trips,public.trip_members,public.trip_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.trips,public.trip_members,public.trip_entries TO authenticated;
CREATE INDEX IF NOT EXISTS trip_owner_date ON public.trips(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS trip_entry_date ON public.trip_entries(trip_id,created_at DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['trips','trip_members','trip_entries'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_trip(p_id uuid,p_profile uuid,p_name text,p_budget numeric,p_start date,p_end date,p_people uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id(); prior public.trips;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_id AND kind='trip') THEN RAISE EXCEPTION 'This trip was deleted'; END IF;
 IF p_id IS NULL OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100 OR p_budget IS NULL OR p_budget<0 OR p_budget>=10000000000 OR p_budget<>round(p_budget,2)
 OR p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_people IS NULL OR cardinality(p_people)>50 THEN RAISE EXCEPTION 'Check the trip details'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_people) x WHERE NOT EXISTS(SELECT 1 FROM public.people WHERE id=x AND profile_id=p_profile)) THEN RAISE EXCEPTION 'Choose people from this profile'; END IF;
 SELECT * INTO prior FROM public.trips WHERE id=p_id;
 IF FOUND THEN
  IF prior.user_id<>owner OR prior.profile_id<>p_profile THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.trip_entries WHERE trip_id=p_id) AND EXISTS(SELECT 1 FROM public.trip_members WHERE trip_id=p_id AND NOT(person_id=ANY(p_people))) THEN RAISE EXCEPTION 'Participants with recorded expenses cannot be removed'; END IF;
 END IF;
 INSERT INTO public.trips(id,user_id,profile_id,name,budget,starts_on,ends_on) VALUES(p_id,owner,p_profile,trim(p_name),p_budget,p_start,p_end)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,budget=excluded.budget,starts_on=excluded.starts_on,ends_on=excluded.ends_on;
 DELETE FROM public.trip_members WHERE trip_id=p_id AND NOT(person_id=ANY(p_people));
 INSERT INTO public.trip_members SELECT p_id,x FROM unnest(p_people) x ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.complete_trip(p_trip uuid,p_completed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.trips SET completed=p_completed WHERE id=p_trip AND user_id=public.current_app_user_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.add_trip_expense(p_id uuid,p_trip uuid,p_reason text,p_amount numeric,p_payer uuid,p_shares jsonb,p_category uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id(); trip public.trips; prior public.trip_entries;
 payload jsonb; own_share numeric; total numeric; row record; person uuid; share numeric;
 expense_ids uuid[] := '{}'; debt_ids uuid[] := '{}'; new_id uuid;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 SELECT * INTO trip FROM public.trips WHERE id=p_trip AND user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=trip.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 SELECT * INTO trip FROM public.trips WHERE id=p_trip AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_id AND kind='expense') THEN RAISE EXCEPTION 'This expense was deleted'; END IF;
 payload:=jsonb_build_object('reason',p_reason,'amount',p_amount,'payer',p_payer,'shares',p_shares,'category',p_category);
 SELECT * INTO prior FROM public.trip_entries WHERE id=p_id;
 IF FOUND THEN
  IF prior.trip_id=p_trip AND prior.request=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'Request already used';
 END IF;
 IF trip.completed THEN RAISE EXCEPTION 'Reopen this trip before adding an expense'; END IF;
 IF p_id IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 200 OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2)
 OR jsonb_typeof(p_shares) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Check the expense details'; END IF;
 IF p_payer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.trip_members WHERE trip_id=p_trip AND person_id=p_payer) THEN RAISE EXCEPTION 'Choose a trip participant'; END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category AND user_id=owner) THEN RAISE EXCEPTION 'Category not found'; END IF;
 total:=0; own_share:=0;
 FOR row IN SELECT * FROM jsonb_each_text(p_shares) LOOP
  share:=row.value::numeric;
  IF share IS NULL OR share<0 OR share>p_amount OR share<>round(share,2) THEN RAISE EXCEPTION 'Invalid split'; END IF;
  IF row.key='me' THEN own_share:=share;
  ELSE
   person:=row.key::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.trip_members WHERE trip_id=p_trip AND person_id=person) THEN RAISE EXCEPTION 'Choose trip participants'; END IF;
  END IF;
  total:=total+share;
 END LOOP;
 IF total<>p_amount THEN RAISE EXCEPTION 'Shares must add up to the total'; END IF;
 INSERT INTO public.trip_entries(id,trip_id,reason,amount,payer,shares,category_id,request) VALUES(p_id,p_trip,trim(p_reason),p_amount,p_payer,p_shares,p_category,payload);
 IF p_payer IS NULL THEN
  UPDATE public.profiles SET balance=coalesce(balance,0)-p_amount WHERE id=trip.profile_id;
  IF own_share>0 THEN
   new_id:=gen_random_uuid(); expense_ids:=array_append(expense_ids,new_id);
   INSERT INTO public.expenses(id,profile_id,reason,amount,category_id,notes,trip_id) VALUES(new_id,trip.profile_id,trim(p_reason),own_share,p_category,'Trip: '||trip.name,p_trip);
  END IF;
  FOR row IN SELECT * FROM jsonb_each_text(p_shares) LOOP
   IF row.key<>'me' AND row.value::numeric>0 THEN
    new_id:=gen_random_uuid(); debt_ids:=array_append(debt_ids,new_id);
    INSERT INTO public.debts(id,profile_id,person_id,direction,amount,remaining_amount,description,trip_id)
    VALUES(new_id,trip.profile_id,row.key::uuid,'they_owe_me',row.value::numeric,row.value::numeric,trip.name||' — '||trim(p_reason),p_trip);
   END IF;
  END LOOP;
 ELSIF own_share>0 THEN
  new_id:=gen_random_uuid(); debt_ids:=array_append(debt_ids,new_id);
  INSERT INTO public.debts(id,profile_id,person_id,direction,amount,remaining_amount,description,trip_id)
  VALUES(new_id,trip.profile_id,p_payer,'i_owe_them',own_share,own_share,trip.name||' — '||trim(p_reason),p_trip);
 END IF;
 UPDATE public.trip_entries SET
 ledger_expenses=(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.expenses e WHERE id=ANY(expense_ids)),
 ledger_debts=(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM public.debts d WHERE id=ANY(debt_ids)) WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_trip(uuid,uuid,text,numeric,date,date,uuid[]),public.complete_trip(uuid,boolean),public.add_trip_expense(uuid,uuid,text,numeric,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_trip(uuid,uuid,text,numeric,date,date,uuid[]),public.complete_trip(uuid,boolean),public.add_trip_expense(uuid,uuid,text,numeric,uuid,jsonb,uuid) TO authenticated;
COMMIT;
