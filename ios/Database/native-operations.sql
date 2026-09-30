-- Run in Supabase SQL Editor after the multi-user auth migration.
-- Adds atomic native operations. Existing rows and balances are not changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.ios_add_expense(p_id uuid, p_profile uuid, p_reason text,
  p_amount numeric, p_notes text DEFAULT '', p_created_at timestamptz DEFAULT now(), p_category uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE existing public.expenses;
BEGIN
  IF p_id IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000000000
     OR p_amount <> round(p_amount,2) OR coalesce(trim(p_reason),'') = '' OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Enter a valid reason, date, and amount';
  END IF;
  PERFORM 1 FROM profiles WHERE id=p_profile FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT * INTO existing FROM expenses WHERE id=p_id;
  IF FOUND THEN
    IF existing.profile_id=p_profile AND existing.reason=trim(p_reason) AND existing.amount=p_amount
      AND existing.category_id IS NOT DISTINCT FROM p_category AND coalesce(existing.notes,'')=trim(coalesce(p_notes,''))
      AND existing.created_at=p_created_at THEN RETURN; END IF;
    RAISE EXCEPTION 'This request was already used. Close and reopen the form.';
  END IF;
  INSERT INTO expenses(id,profile_id,reason,amount,notes,created_at,category_id)
  VALUES(p_id,p_profile,trim(p_reason),p_amount,nullif(trim(p_notes),''),p_created_at,p_category);
  UPDATE profiles SET balance=coalesce(balance,0)-p_amount WHERE id=p_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.ios_delete_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE target uuid; row_data public.expenses;
BEGIN
  SELECT profile_id INTO target FROM expenses WHERE id=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM profiles WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT * INTO row_data FROM expenses WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF row_data.profile_id<>target THEN RAISE EXCEPTION 'Expense changed. Refresh and try again.'; END IF;
  DELETE FROM expenses WHERE id=p_id;
  UPDATE profiles SET balance=coalesce(balance,0)+row_data.amount WHERE id=target;
END;
$$;

CREATE OR REPLACE FUNCTION public.ios_move_expense(p_id uuid, p_from uuid, p_to uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE row_data public.expenses;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from=p_to THEN RAISE EXCEPTION 'Choose another account'; END IF;
  PERFORM id FROM profiles WHERE id IN(p_from,p_to) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM profiles WHERE id IN(p_from,p_to))<>2 THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT * INTO row_data FROM expenses WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense no longer exists'; END IF;
  IF row_data.profile_id=p_to THEN RETURN; END IF;
  IF row_data.profile_id<>p_from THEN RAISE EXCEPTION 'Expense changed. Refresh and try again.'; END IF;
  UPDATE expenses SET profile_id=p_to WHERE id=p_id;
  UPDATE profiles SET balance=coalesce(balance,0)+row_data.amount WHERE id=p_from;
  UPDATE profiles SET balance=coalesce(balance,0)-row_data.amount WHERE id=p_to;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ios_tab_requests (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(user_id,id)
);
ALTER TABLE public.ios_tab_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_requests ON public.ios_tab_requests;
CREATE POLICY own_requests ON public.ios_tab_requests FOR ALL TO authenticated
  USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
REVOKE ALL ON public.ios_tab_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ios_tab_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.ios_add_tabs(p_id uuid, p_profile uuid, p_rows jsonb, p_own_share numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE request jsonb; stored jsonb; inserted uuid;
BEGIN
  IF p_id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in and retry'; END IF;
  request:=jsonb_build_object('profile',p_profile,'rows',p_rows,'own_share',p_own_share);
  INSERT INTO ios_tab_requests(id,payload) VALUES(p_id,request)
  ON CONFLICT(user_id,id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    SELECT payload INTO stored FROM ios_tab_requests WHERE id=p_id AND user_id=auth.uid();
    IF stored IS NOT DISTINCT FROM request THEN RETURN; END IF;
    RAISE EXCEPTION 'This request was already used. Close and reopen the form.';
  END IF;
  PERFORM public.add_tab(p_profile,p_rows,p_own_share);
END;
$$;

REVOKE ALL ON FUNCTION public.ios_add_expense(uuid,uuid,text,numeric,text,timestamptz,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ios_delete_expense(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ios_move_expense(uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ios_add_tabs(uuid,uuid,jsonb,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ios_add_expense(uuid,uuid,text,numeric,text,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ios_delete_expense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ios_move_expense(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ios_add_tabs(uuid,uuid,jsonb,numeric) TO authenticated;
COMMIT;
