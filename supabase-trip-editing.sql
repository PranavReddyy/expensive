-- Run after the updated supabase-trips.sql. No balance changes on installation.
BEGIN;
CREATE TABLE IF NOT EXISTS app_private.trip_edit_requests (
 user_id uuid NOT NULL REFERENCES app_private.app_accounts(id), id uuid NOT NULL,
 entry_id uuid NOT NULL REFERENCES public.trip_entries(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, PRIMARY KEY(user_id,id)
);
REVOKE ALL ON app_private.trip_edit_requests FROM PUBLIC,anon,authenticated;

-- Old entries did not store ledger IDs. Link only an unambiguous, untouched
-- transaction whose rows exactly match the original bill. Never guess ownership.
DO $$ DECLARE item public.trip_entries; t public.trips; es jsonb; ds jsonb; own numeric; expected integer;
BEGIN
 FOR item IN SELECT * FROM public.trip_entries WHERE ledger_expenses IS NULL LOOP
  SELECT * INTO t FROM public.trips WHERE id=item.trip_id;
  IF (SELECT count(*) FROM public.trip_entries WHERE trip_id=item.trip_id AND created_at=item.created_at)<>1 THEN CONTINUE; END IF;
  own:=coalesce((item.shares->>'me')::numeric,0);
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO es FROM public.expenses e WHERE trip_id=item.trip_id AND created_at=item.created_at;
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO ds FROM public.debts d WHERE trip_id=item.trip_id AND created_at=item.created_at;
  IF jsonb_array_length(es)<>(CASE WHEN item.payer IS NULL AND own>0 THEN 1 ELSE 0 END) THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(es) e WHERE (e->>'profile_id')::uuid<>t.profile_id OR e->>'reason'<>item.reason
   OR (e->>'amount')::numeric<>own OR (e->>'category_id') IS DISTINCT FROM item.category_id::text OR coalesce((e->>'version')::bigint,1)<>1) THEN CONTINUE; END IF;
  IF item.payer IS NULL THEN
   SELECT count(*) INTO expected FROM jsonb_each_text(item.shares) WHERE key<>'me' AND value::numeric>0;
  ELSE expected:=CASE WHEN own>0 THEN 1 ELSE 0 END; END IF;
  IF jsonb_array_length(ds)<>expected THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(ds) d WHERE (d->>'profile_id')::uuid<>t.profile_id
   OR (d->>'remaining_amount')::numeric<>(d->>'amount')::numeric OR d->>'settled_at' IS NOT NULL
   OR (item.payer IS NULL AND (d->>'direction'<>'they_owe_me' OR (d->>'amount')::numeric IS DISTINCT FROM (item.shares->>(d->>'person_id'))::numeric))
   OR (item.payer IS NOT NULL AND (d->>'direction'<>'i_owe_them' OR (d->>'person_id')::uuid<>item.payer OR (d->>'amount')::numeric<>own))) THEN CONTINUE; END IF;
  IF (SELECT count(DISTINCT d->>'person_id') FROM jsonb_array_elements(ds) d)<>expected THEN CONTINUE; END IF;
  UPDATE public.trip_entries SET ledger_expenses=es,ledger_debts=ds WHERE id=item.id;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.edit_trip_expense(p_request uuid,p_id uuid,p_version bigint,p_reason text,p_amount numeric,p_payer uuid,p_shares jsonb,p_category uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=public.current_app_user_id(); item public.trip_entries; t public.trips;
 payload jsonb; prior jsonb; current_es jsonb; current_ds jsonb; replacement uuid:=gen_random_uuid(); fresh public.trip_entries;
BEGIN
 IF owner IS NULL OR p_request IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'Sign in and reopen this expense'; END IF;
 SELECT trips.* INTO t FROM public.trips trips JOIN public.trip_entries e ON e.trip_id=trips.id WHERE e.id=p_id AND trips.user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip expense not found'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=t.profile_id AND user_id=owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 PERFORM 1 FROM public.trips WHERE id=t.id FOR UPDATE;
 payload:=jsonb_build_object('entry',p_id,'version',p_version,'reason',p_reason,'amount',p_amount,'payer',p_payer,'shares',p_shares,'category',p_category);
 SELECT r.payload INTO prior FROM app_private.trip_edit_requests r WHERE user_id=owner AND id=p_request;
 IF FOUND THEN
  IF prior=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'Request already used';
 END IF;
 SELECT * INTO item FROM public.trip_entries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR item.version<>p_version THEN RAISE EXCEPTION 'This expense changed. Close and reopen it.'; END IF;
 IF item.ledger_expenses IS NULL OR item.ledger_debts IS NULL THEN RAISE EXCEPTION 'This older expense cannot be safely edited because its linked records changed or cannot be identified.'; END IF;
 PERFORM 1 FROM public.expenses WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses)) FOR UPDATE;
 PERFORM 1 FROM public.debts WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts)) FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO current_es FROM public.expenses e WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses));
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO current_ds FROM public.debts d WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts));
 IF current_es IS DISTINCT FROM item.ledger_expenses OR current_ds IS DISTINCT FROM item.ledger_debts THEN
  RAISE EXCEPTION 'Related expenses or Tabs changed. Undo payments first; edited or deleted records cannot be overwritten.';
 END IF;
 -- Reverse only this entry's original cash movement. The new operation validates
 -- all fields and applies the replacement atomically; failure rolls everything back.
 DELETE FROM public.expenses WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_expenses));
 DELETE FROM public.debts WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(item.ledger_debts));
 IF item.payer IS NULL THEN UPDATE public.profiles SET balance=coalesce(balance,0)+item.amount WHERE id=t.profile_id; END IF;
 PERFORM public.add_trip_expense(replacement,t.id,p_reason,p_amount,p_payer,p_shares,p_category);
 SELECT * INTO fresh FROM public.trip_entries WHERE id=replacement;
 -- Preserve the bill's date and original creation receipt for late add retries.
 UPDATE public.expenses SET created_at=item.created_at WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(fresh.ledger_expenses));
 UPDATE public.debts SET created_at=item.created_at WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(fresh.ledger_debts));
 UPDATE public.trip_entries SET reason=fresh.reason,amount=fresh.amount,payer=fresh.payer,shares=fresh.shares,category_id=fresh.category_id,version=item.version+1,
 ledger_expenses=(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.expenses e WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(fresh.ledger_expenses))),
 ledger_debts=(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM public.debts d WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(fresh.ledger_debts))) WHERE id=p_id;
 DELETE FROM public.trip_entries WHERE id=replacement;
 INSERT INTO app_private.trip_edit_requests VALUES(owner,p_request,p_id,payload);
END $$;
REVOKE ALL ON FUNCTION public.edit_trip_expense(uuid,uuid,bigint,text,numeric,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_trip_expense(uuid,uuid,bigint,text,numeric,uuid,jsonb,uuid) TO authenticated;
COMMIT;
