-- Run AFTER supabase-firebase-migration.sql. Does not change existing balances.
BEGIN;
CREATE TABLE IF NOT EXISTS public.account_activity (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  person_id uuid,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('settlement','balance')),
  amount numeric NOT NULL,
  balance_delta numeric NOT NULL,
  request jsonb NOT NULL,
  before_debts jsonb,
  after_debts jsonb,
  payment_expense jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  undone_at timestamptz
);
ALTER TABLE public.account_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_read ON public.account_activity;
CREATE POLICY owner_read ON public.account_activity FOR SELECT TO authenticated
 USING (user_id = (SELECT public.current_app_user_id()));
REVOKE ALL ON public.account_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_activity TO authenticated;
CREATE INDEX IF NOT EXISTS activity_profile_date ON public.account_activity(profile_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.adjust_balance(p_id uuid,p_profile uuid,p_mode text,p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := public.current_app_user_id(); old_balance numeric; delta numeric; prior public.account_activity; payload jsonb;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF p_id IS NULL OR p_mode NOT IN ('set','add','subtract') OR p_mode IS NULL OR p_amount IS NULL
 OR abs(p_amount)>=10000000000 OR p_amount<>round(p_amount,2)
 OR (p_mode<>'set' AND p_amount<=0) THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
 SELECT coalesce(balance,0) INTO old_balance FROM profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 payload:=jsonb_build_object('mode',p_mode,'amount',p_amount);
 SELECT * INTO prior FROM account_activity WHERE id=p_id;
 IF FOUND THEN
   IF prior.user_id=owner AND prior.profile_id=p_profile AND prior.kind='balance' AND prior.request=payload THEN RETURN; END IF;
   RAISE EXCEPTION 'Request already used';
 END IF;
 delta:=CASE p_mode WHEN 'set' THEN p_amount-old_balance WHEN 'add' THEN p_amount ELSE -p_amount END;
 IF abs(old_balance+delta)>=10000000000 THEN RAISE EXCEPTION 'Balance exceeds supported amount'; END IF;
 UPDATE profiles SET balance=old_balance+delta WHERE id=p_profile;
 INSERT INTO account_activity(id,user_id,profile_id,title,kind,amount,balance_delta,request)
 VALUES(p_id,owner,p_profile,'Balance '||p_mode,'balance',p_amount,delta,payload);
END $$;

CREATE OR REPLACE FUNCTION public.record_tab_payment(p_id uuid,p_profile uuid,p_person uuid,p_payment numeric,p_expected_collect numeric,p_expected_pay numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := public.current_app_user_id(); prior public.account_activity; payload jsonb; before_rows jsonb; after_rows jsonb;
 old_balance numeric; person_name text; payment_row jsonb;
 collect numeric; pay numeric; consume numeric; direction_name text; d record; used numeric; expense_id uuid;
BEGIN
 IF owner IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 SELECT coalesce(balance,0) INTO old_balance FROM profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 SELECT name INTO person_name FROM people WHERE id=p_person AND profile_id=p_profile;
 IF NOT FOUND THEN RAISE EXCEPTION 'Person not found'; END IF;
 payload:=jsonb_build_object('person',p_person,'payment',p_payment,'collect',p_expected_collect,'pay',p_expected_pay);
 SELECT * INTO prior FROM account_activity WHERE id=p_id;
 IF FOUND THEN
   IF prior.user_id=owner AND prior.profile_id=p_profile AND prior.kind='settlement' AND prior.request=payload THEN RETURN; END IF;
   RAISE EXCEPTION 'Request already used';
 END IF;
 PERFORM 1 FROM debts WHERE profile_id=p_profile AND person_id=p_person FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY entry.id),'[]') INTO before_rows FROM debts entry WHERE profile_id=p_profile AND person_id=p_person;
 SELECT coalesce(sum(remaining_amount) FILTER (WHERE direction='they_owe_me'),0),
 coalesce(sum(remaining_amount) FILTER (WHERE direction='i_owe_them'),0) INTO collect,pay
 FROM debts WHERE profile_id=p_profile AND person_id=p_person;
 IF collect IS DISTINCT FROM p_expected_collect OR pay IS DISTINCT FROM p_expected_pay THEN RAISE EXCEPTION 'This tab changed. Close and reopen it.'; END IF;
 IF p_payment IS NULL OR p_payment<0 OR p_payment<>round(p_payment,2) OR p_payment>abs(collect-pay)
 OR (p_payment=0 AND (collect<>pay OR collect=0)) THEN RAISE EXCEPTION 'Enter a payment up to the net amount'; END IF;
 FOREACH direction_name IN ARRAY ARRAY['they_owe_me','i_owe_them'] LOOP
   consume:=least(collect,pay)+CASE WHEN (direction_name='they_owe_me' AND collect>pay) OR (direction_name='i_owe_them' AND pay>collect) THEN p_payment ELSE 0 END;
   FOR d IN SELECT * FROM debts WHERE profile_id=p_profile AND person_id=p_person AND direction=direction_name AND remaining_amount>0 ORDER BY created_at,id LOOP
     EXIT WHEN consume<=0;
     used:=least(consume,d.remaining_amount);
     UPDATE debts SET remaining_amount=remaining_amount-used,settled_at=CASE WHEN remaining_amount-used=0 THEN now() ELSE NULL END WHERE id=d.id;
     consume:=consume-used;
   END LOOP;
 END LOOP;
 UPDATE profiles SET balance=coalesce(balance,0)+CASE WHEN collect>pay THEN p_payment ELSE -p_payment END WHERE id=p_profile;
 IF pay>collect AND p_payment>0 THEN
   expense_id:=gen_random_uuid();
   INSERT INTO expenses(id,profile_id,reason,amount,notes) VALUES(expense_id,p_profile,'Tab payment — '||person_name,p_payment,'Payment recorded from Tabs');
   SELECT to_jsonb(e) INTO payment_row FROM expenses e WHERE id=expense_id;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY entry.id),'[]') INTO after_rows FROM debts entry WHERE profile_id=p_profile AND person_id=p_person;
 INSERT INTO account_activity(id,user_id,profile_id,person_id,title,kind,amount,balance_delta,request,before_debts,after_debts,payment_expense)
 SELECT p_id,owner,p_profile,p_person,person_name,'settlement',p_payment,coalesce(balance,0)-old_balance,payload,before_rows,after_rows,payment_row FROM profiles WHERE id=p_profile;
END $$;

CREATE OR REPLACE FUNCTION public.undo_tab_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := public.current_app_user_id(); item public.account_activity; current_rows jsonb; current_expense jsonb; row_data jsonb;
BEGIN
 SELECT * INTO item FROM account_activity WHERE id=p_id AND user_id=owner AND kind='settlement';
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment log not found'; END IF;
 PERFORM 1 FROM profiles WHERE id=item.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 SELECT * INTO item FROM account_activity WHERE id=p_id FOR UPDATE;
 IF item.undone_at IS NOT NULL THEN RETURN; END IF;
 PERFORM 1 FROM debts WHERE profile_id=item.profile_id AND person_id=item.person_id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO current_rows FROM debts d WHERE profile_id=item.profile_id AND person_id=item.person_id;
 IF current_rows IS DISTINCT FROM item.after_debts THEN RAISE EXCEPTION 'This tab has changed. Undo newer payments first; changed entries cannot be overwritten.'; END IF;
 IF item.payment_expense IS NOT NULL THEN
   SELECT to_jsonb(e) INTO current_expense FROM expenses e WHERE id=(item.payment_expense->>'id')::uuid FOR UPDATE;
   IF current_expense IS DISTINCT FROM item.payment_expense THEN RAISE EXCEPTION 'The payment expense was changed or deleted. Undo is no longer safe.'; END IF;
   DELETE FROM expenses WHERE id=(item.payment_expense->>'id')::uuid;
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(item.before_debts) LOOP
   UPDATE debts SET remaining_amount=(row_data->>'remaining_amount')::numeric,settled_at=(row_data->>'settled_at')::timestamptz
   WHERE id=(row_data->>'id')::uuid;
 END LOOP;
 UPDATE profiles SET balance=coalesce(balance,0)-item.balance_delta WHERE id=item.profile_id;
 UPDATE account_activity SET undone_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.adjust_balance(uuid,uuid,text,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_tab_payment(uuid,uuid,uuid,numeric,numeric,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.undo_tab_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_balance(uuid,uuid,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_tab_payment(uuid,uuid,uuid,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_tab_payment(uuid) TO authenticated;
COMMIT;
