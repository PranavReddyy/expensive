-- Run after activity-history.sql. Reuses its atomic settlement/undo snapshots.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_tab_on_me(p_id uuid,p_profile uuid,p_person uuid,p_payment numeric,p_expected_collect numeric,p_expected_pay numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := public.current_app_user_id(); prior public.account_activity; payload jsonb; expense_id uuid; person_name text;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 PERFORM 1 FROM profiles WHERE id=p_profile AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 IF p_id IS NULL OR p_payment IS NULL OR p_payment <= 0 OR p_payment >= 10000000000
 OR p_payment <> round(p_payment,2) OR p_expected_collect IS NULL OR p_expected_pay IS NULL
 OR p_expected_collect <= p_expected_pay THEN RAISE EXCEPTION 'Choose an amount they owe you'; END IF;
 payload:=jsonb_build_object('person',p_person,'payment',p_payment,'collect',p_expected_collect,'pay',p_expected_pay,'on_me',true);
 SELECT * INTO prior FROM account_activity WHERE id=p_id;
 IF FOUND THEN
   IF prior.user_id=owner AND prior.profile_id=p_profile AND prior.kind='settlement' AND prior.request=payload THEN RETURN; END IF;
   RAISE EXCEPTION 'Request already used';
 END IF;
 -- Validates current totals and ownership, offsets mutual debts, and snapshots
 -- exactly the rows touched. Any error rolls back this entire function call.
 PERFORM public.record_tab_payment(p_id,p_profile,p_person,p_payment,p_expected_collect,p_expected_pay);
 -- A collect entry already reduced cash when originally created. Forgiveness
 -- does not receive money: cancel the settlement's credit, not a second debit.
 UPDATE profiles SET balance=balance-p_payment WHERE id=p_profile;
 SELECT name INTO person_name FROM people WHERE id=p_person AND profile_id=p_profile;
 expense_id:=gen_random_uuid();
 INSERT INTO expenses(id,profile_id,reason,amount,notes)
 VALUES(expense_id,p_profile,'On me — '||person_name,p_payment,'Forgiven tab; money was already deducted when paid');
 UPDATE account_activity SET request=payload,title='On me — '||person_name,balance_delta=0,
   payment_expense=(SELECT to_jsonb(e) FROM expenses e WHERE e.id=expense_id)
 WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.record_tab_on_me(uuid,uuid,uuid,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_tab_on_me(uuid,uuid,uuid,numeric,numeric,numeric) TO authenticated;
COMMIT;
