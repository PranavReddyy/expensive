-- Apply after the current supabase-trips.sql and supabase-trip-editing.sql.
-- Defines operations only; does not delete any user data on installation.
BEGIN;
CREATE OR REPLACE FUNCTION public.delete_trip_expense(p_id uuid,p_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id(); item public.trip_entries; t public.trips; es jsonb; ds jsonb;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_id AND kind='expense' AND user_id=owner) THEN RETURN; END IF;
 SELECT trips.* INTO t FROM public.trips trips JOIN public.trip_entries e ON e.trip_id=trips.id WHERE e.id=p_id AND trips.user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip expense not found'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=t.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 PERFORM 1 FROM public.trips WHERE id=t.id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_id AND kind='expense' AND user_id=owner) THEN RETURN; END IF;
 SELECT * INTO item FROM public.trip_entries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR p_version IS NULL OR item.version<>p_version THEN RAISE EXCEPTION 'This expense changed. Refresh and try again.'; END IF;
 IF item.ledger_expenses IS NULL OR item.ledger_debts IS NULL THEN RAISE EXCEPTION 'This older bill cannot be safely deleted because its linked records changed or cannot be identified.'; END IF;
 PERFORM 1 FROM public.expenses WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses)) FOR UPDATE;
 PERFORM 1 FROM public.debts WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts)) FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO es FROM public.expenses e WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses));
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO ds FROM public.debts d WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts));
 IF es IS DISTINCT FROM item.ledger_expenses OR ds IS DISTINCT FROM item.ledger_debts THEN RAISE EXCEPTION 'Related expenses or Tabs changed. Undo payments first; changed records cannot be deleted.'; END IF;
 IF item.payer IS NULL THEN
  UPDATE public.profiles SET balance=coalesce(balance,0)+item.amount WHERE id=t.profile_id AND abs(coalesce(balance,0)+item.amount)<10000000000;
  IF NOT FOUND THEN RAISE EXCEPTION 'Balance exceeds supported amount'; END IF;
 END IF;
 DELETE FROM public.expenses WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses));
 DELETE FROM public.debts WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts));
 INSERT INTO app_private.trip_deletions VALUES(owner,p_id,'expense');
 DELETE FROM public.trip_entries WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_trip(p_trip uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id(); t public.trips;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_trip AND kind='trip' AND user_id=owner) THEN RETURN; END IF;
 SELECT * INTO t FROM public.trips WHERE id=p_trip AND user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=t.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.trip_deletions WHERE id=p_trip AND kind='trip' AND user_id=owner) THEN RETURN; END IF;
 PERFORM 1 FROM public.trips WHERE id=p_trip AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
 INSERT INTO app_private.trip_deletions SELECT owner,id,'expense' FROM public.trip_entries WHERE trip_id=p_trip ON CONFLICT DO NOTHING;
 INSERT INTO app_private.trip_deletions VALUES(owner,p_trip,'trip');
 -- FK SET NULL removes only the grouping. Financial records and balances stay.
 DELETE FROM public.trips WHERE id=p_trip;
END $$;
REVOKE ALL ON FUNCTION public.delete_trip(uuid),public.delete_trip_expense(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_trip(uuid),public.delete_trip_expense(uuid,bigint) TO authenticated;
COMMIT;
