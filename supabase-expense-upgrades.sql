-- Run AFTER supabase-firebase-migration.sql and ios/Database/activity-history.sql.
-- Adds review-first recurring expenses, conflict-safe edits and durable creation receipts.
-- No existing balance is changed. Safe to run again.
BEGIN;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.expense_requests (
  user_id uuid NOT NULL, id uuid NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(user_id,id)
);
ALTER TABLE public.expense_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_requests FROM PUBLIC,anon,authenticated;
-- Preserve retry tombstones for expenses created before this migration, too.
INSERT INTO public.expense_requests(user_id,id,payload)
SELECT p.user_id,e.id,jsonb_build_object('profile',e.profile_id,'reason',e.reason,'amount',e.amount,
 'notes',coalesce(e.notes,''),'date',e.created_at,'category',e.category_id)
FROM public.expenses e JOIN public.profiles p ON p.id=e.profile_id WHERE p.user_id IS NOT NULL
ON CONFLICT DO NOTHING;
-- Old settlement snapshots predate the version column; retain their undo compatibility.
UPDATE public.account_activity SET payment_expense=payment_expense||jsonb_build_object('version',1)
WHERE payment_expense IS NOT NULL AND NOT payment_expense ? 'version';

CREATE OR REPLACE FUNCTION public.bump_expense_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN NEW.version:=OLD.version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS expense_version ON public.expenses;
CREATE TRIGGER expense_version BEFORE UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.bump_expense_version();

CREATE OR REPLACE FUNCTION public.ios_add_expense(p_id uuid,p_profile uuid,p_reason text,
 p_amount numeric,p_notes text DEFAULT '',p_created_at timestamptz DEFAULT now(),p_category uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=public.current_app_user_id(); request jsonb; prior jsonb; existing public.expenses;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF p_id IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000
 OR p_amount<>round(p_amount,2) OR coalesce(trim(p_reason),'')='' OR p_created_at IS NULL
 THEN RAISE EXCEPTION 'Enter a valid reason, date, and amount'; END IF;
 PERFORM 1 FROM profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 request:=jsonb_build_object('profile',p_profile,'reason',trim(p_reason),'amount',p_amount,
 'notes',trim(coalesce(p_notes,'')),'date',p_created_at,'category',p_category);
 -- Serialize equal IDs even when requests target different profiles.
 PERFORM pg_advisory_xact_lock(hashtextextended(owner::text||p_id::text,0));
 SELECT payload INTO prior FROM expense_requests WHERE user_id=owner AND id=p_id;
 IF FOUND THEN
   IF prior=request THEN RETURN; END IF;
   RAISE EXCEPTION 'This request was already used. Close and reopen the form.';
 END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=p_category AND user_id=owner AND NOT archived)
 THEN RAISE EXCEPTION 'Choose an available category'; END IF;
 SELECT * INTO existing FROM expenses WHERE id=p_id;
 IF FOUND THEN
   IF existing.profile_id<>p_profile OR existing.reason<>trim(p_reason) OR existing.amount<>p_amount
   OR existing.category_id IS DISTINCT FROM p_category OR coalesce(existing.notes,'')<>trim(coalesce(p_notes,''))
   OR existing.created_at<>p_created_at THEN RAISE EXCEPTION 'This request was already used'; END IF;
 ELSE
   INSERT INTO expenses(id,profile_id,reason,amount,notes,created_at,category_id)
   VALUES(p_id,p_profile,trim(p_reason),p_amount,nullif(trim(p_notes),''),p_created_at,p_category);
   UPDATE profiles SET balance=coalesce(balance,0)-p_amount WHERE id=p_profile;
 END IF;
 INSERT INTO expense_requests VALUES(owner,p_id,request);
END $$;

CREATE OR REPLACE FUNCTION public.edit_expense(p_request uuid,p_id uuid,p_version bigint,
 p_reason text,p_amount numeric,p_notes text,p_created_at timestamptz,p_category uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=public.current_app_user_id(); target uuid; item public.expenses; request jsonb; prior jsonb;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF p_request IS NULL OR p_version IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000
 OR p_amount<>round(p_amount,2) OR coalesce(trim(p_reason),'')='' OR p_created_at IS NULL
 THEN RAISE EXCEPTION 'Enter a valid reason, date, and amount'; END IF;
 SELECT e.profile_id INTO target FROM expenses e JOIN profiles p ON p.id=e.profile_id WHERE e.id=p_id AND p.user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense no longer exists'; END IF;
 PERFORM 1 FROM profiles WHERE id=target AND user_id=owner FOR UPDATE;
 request:=jsonb_build_object('edit',p_id,'version',p_version,'reason',trim(p_reason),'amount',p_amount,
 'notes',trim(coalesce(p_notes,'')),'date',p_created_at,'category',p_category);
 PERFORM pg_advisory_xact_lock(hashtextextended(owner::text||p_request::text,0));
 SELECT payload INTO prior FROM expense_requests WHERE user_id=owner AND id=p_request;
 IF FOUND THEN
   IF prior=request THEN RETURN; END IF;
   RAISE EXCEPTION 'This request was already used';
 END IF;
 SELECT * INTO item FROM expenses WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR item.profile_id<>target OR item.version<>p_version THEN RAISE EXCEPTION 'Expense changed. Reopen it before editing.'; END IF;
 IF EXISTS(SELECT 1 FROM account_activity WHERE payment_expense->>'id'=p_id::text AND undone_at IS NULL)
 THEN RAISE EXCEPTION 'Undo this tab payment in History before changing its expense.'; END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=p_category AND user_id=owner AND (NOT archived OR id=item.category_id))
 THEN RAISE EXCEPTION 'Choose an available category'; END IF;
 UPDATE expenses SET reason=trim(p_reason),amount=p_amount,notes=nullif(trim(p_notes),''),created_at=p_created_at,category_id=p_category WHERE id=p_id;
 UPDATE profiles SET balance=coalesce(balance,0)+item.amount-p_amount WHERE id=target;
 INSERT INTO expense_requests VALUES(owner,p_request,request);
END $$;

CREATE TABLE IF NOT EXISTS public.recurring_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT public.current_app_user_id(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 200),
 amount numeric NOT NULL CHECK(amount>0 AND amount<10000000000 AND amount=round(amount,2)),
 category_id uuid REFERENCES public.categories(id), notes text NOT NULL DEFAULT '',
 cadence text NOT NULL CHECK(cadence IN ('weekly','monthly','yearly')),
 anchor_date date NOT NULL, next_due date NOT NULL, paused boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_owner ON public.recurring_expenses;
CREATE POLICY recurring_owner ON public.recurring_expenses FOR SELECT TO authenticated USING(user_id=(SELECT public.current_app_user_id()));
REVOKE ALL ON public.recurring_expenses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recurring_expenses TO authenticated;
CREATE INDEX IF NOT EXISTS recurring_owner_due ON public.recurring_expenses(user_id,next_due);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
 SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='recurring_expenses')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.recurring_expenses; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
 rule_id uuid NOT NULL REFERENCES public.recurring_expenses(id) ON DELETE CASCADE,
 due date NOT NULL, action text NOT NULL CHECK(action IN ('record','skip')), expense_id uuid,
 PRIMARY KEY(rule_id,due)
);
ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recurring_occurrences FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.add_recurring_expense(p_id uuid,p_profile uuid,p_reason text,p_amount numeric,
 p_category uuid,p_notes text,p_cadence text,p_start date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=public.current_app_user_id(); existing public.recurring_expenses;
BEGIN
 IF owner IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 PERFORM 1 FROM profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=p_category AND user_id=owner AND NOT archived)
 THEN RAISE EXCEPTION 'Choose an available category'; END IF;
 SELECT * INTO existing FROM recurring_expenses WHERE id=p_id;
 IF FOUND THEN
   IF existing.user_id=owner AND existing.profile_id=p_profile AND existing.reason=trim(p_reason) AND existing.amount=p_amount
   AND existing.category_id IS NOT DISTINCT FROM p_category AND existing.notes=coalesce(p_notes,'')
   AND existing.cadence=p_cadence AND existing.anchor_date=p_start THEN RETURN; END IF;
   RAISE EXCEPTION 'This request was already used';
 END IF;
 INSERT INTO recurring_expenses(id,user_id,profile_id,reason,amount,category_id,notes,cadence,anchor_date,next_due)
 VALUES(p_id,owner,p_profile,trim(p_reason),p_amount,p_category,coalesce(p_notes,''),p_cadence,p_start,p_start);
END $$;

CREATE OR REPLACE FUNCTION public.pause_recurring_expense(p_id uuid,p_paused boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE recurring_expenses SET paused=p_paused WHERE id=p_id AND user_id=public.current_app_user_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.review_recurring_expense(p_id uuid,p_due date,p_action text,p_date timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=public.current_app_user_id(); item public.recurring_expenses; prior public.recurring_occurrences;
 next_month date; next_date date; new_id uuid:=gen_random_uuid();
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('record','skip') OR p_due IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'Invalid review'; END IF;
 SELECT * INTO item FROM recurring_expenses WHERE id=p_id AND user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found'; END IF;
 -- Same profile-before-schedule lock order as creation and other money operations.
 PERFORM 1 FROM profiles WHERE id=item.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 SELECT * INTO item FROM recurring_expenses WHERE id=p_id FOR UPDATE;
 SELECT * INTO prior FROM recurring_occurrences WHERE rule_id=p_id AND due=p_due;
 IF FOUND THEN
   IF prior.action=p_action THEN RETURN; END IF;
   RAISE EXCEPTION 'This occurrence was already reviewed';
 END IF;
 IF item.paused OR item.next_due<>p_due THEN RAISE EXCEPTION 'Schedule changed. Refresh and try again.'; END IF;
 -- One-day allowance accommodates local dates ahead of the database UTC date.
 IF p_due>current_date+1 THEN RAISE EXCEPTION 'This expense is not due yet'; END IF;
 IF p_action='record' THEN
   PERFORM ios_add_expense(new_id,item.profile_id,item.reason,item.amount,item.notes,p_date,item.category_id);
 ELSE new_id:=NULL;
 END IF;
 IF item.cadence='weekly' THEN next_date:=p_due+7;
 ELSE
   next_month:=(date_trunc('month',p_due)+(CASE item.cadence WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END))::date;
   next_date:=next_month+least(extract(day FROM item.anchor_date)::int,extract(day FROM next_month+interval '1 month'-interval '1 day')::int)-1;
 END IF;
 INSERT INTO recurring_occurrences VALUES(p_id,p_due,p_action,new_id);
 UPDATE recurring_expenses SET next_due=next_date WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_category(p_id uuid,p_name text,p_order integer,p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=public.current_app_user_id();
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF p_id IS NULL OR length(trim(coalesce(p_name,''))) NOT BETWEEN 1 AND 80 OR p_order IS NULL OR p_archived IS NULL
 THEN RAISE EXCEPTION 'Enter a category name of 1–80 characters'; END IF;
 INSERT INTO categories(id,user_id,name,sort_order,archived) VALUES(p_id,owner,trim(p_name),p_order,p_archived)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,archived=EXCLUDED.archived
 WHERE categories.user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_category(uuid,text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_category(uuid,text,integer,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.ios_add_expense(uuid,uuid,text,numeric,text,timestamptz,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.edit_expense(uuid,uuid,bigint,text,numeric,text,timestamptz,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.add_recurring_expense(uuid,uuid,text,numeric,uuid,text,text,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pause_recurring_expense(uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_recurring_expense(uuid,date,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ios_add_expense(uuid,uuid,text,numeric,text,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid,uuid,bigint,text,numeric,text,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_recurring_expense(uuid,uuid,text,numeric,uuid,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_recurring_expense(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_recurring_expense(uuid,date,text,timestamptz) TO authenticated;
COMMIT;
