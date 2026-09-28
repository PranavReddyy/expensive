-- Run in Supabase SQL Editor before using profile transfers.
BEGIN;
CREATE TABLE IF NOT EXISTS public.profile_transfers (
  id uuid PRIMARY KEY,
  from_profile uuid NOT NULL REFERENCES public.profiles(id),
  to_profile uuid NOT NULL REFERENCES public.profiles(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_profile <> to_profile)
);
ALTER TABLE public.profile_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_profile_transfers ON public.profile_transfers;
CREATE POLICY allow_all_profile_transfers ON public.profile_transfers
  FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.transfer_money(p_id uuid, p_from uuid, p_to uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE previous public.profile_transfers; available numeric;
BEGIN
  IF p_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Choose two different accounts';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000000000 OR p_amount <> round(p_amount,2) THEN
    RAISE EXCEPTION 'Enter a valid amount with up to two decimals';
  END IF;
  -- Lock both accounts in a consistent order; concurrent transfers cannot lose updates.
  PERFORM id FROM profiles WHERE id IN (p_from,p_to) ORDER BY id FOR UPDATE;
  SELECT * INTO previous FROM profile_transfers WHERE id = p_id;
  IF FOUND THEN
    IF previous.from_profile = p_from AND previous.to_profile = p_to AND previous.amount = p_amount THEN RETURN; END IF;
    RAISE EXCEPTION 'This transfer request was already used';
  END IF;
  SELECT coalesce(balance,0) INTO available FROM profiles WHERE id = p_from;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_to) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  IF available < p_amount THEN RAISE EXCEPTION 'Not enough money in the source account'; END IF;
  INSERT INTO profile_transfers(id,from_profile,to_profile,amount) VALUES(p_id,p_from,p_to,p_amount);
  UPDATE profiles SET balance = coalesce(balance,0)-p_amount WHERE id = p_from;
  UPDATE profiles SET balance = coalesce(balance,0)+p_amount WHERE id = p_to;
END;
$$;
COMMIT;
