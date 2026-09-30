-- Test fixture from the pre-auth Expensive schema; never run against production.
-- Fresh Supabase setup for Expens***. Run once in SQL Editor.
BEGIN;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  balance DECIMAL(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#888888',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  reason TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  category_id UUID REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS people (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('they_owe_me', 'i_owe_them')),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  remaining_amount DECIMAL(12, 2) NOT NULL CHECK (remaining_amount >= 0),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profile_transfers (
  id UUID PRIMARY KEY,
  from_profile UUID NOT NULL REFERENCES profiles(id),
  to_profile UUID NOT NULL REFERENCES profiles(id),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_profile <> to_profile)
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_transfers ENABLE ROW LEVEL SECURITY;

-- Open policies for personal app (no user auth)
CREATE POLICY "allow_all_profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_people" ON people FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_debts" ON debts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_profile_transfers" ON profile_transfers FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime (run these in Supabase dashboard > Database > Replication)
-- Or add the tables to the realtime publication:
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE people;
ALTER PUBLICATION supabase_realtime ADD TABLE debts;

CREATE OR REPLACE FUNCTION public.add_tab(p_profile uuid, p_rows jsonb, p_own_share numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r jsonb; a numeric; outgoing numeric := 0; description text;
BEGIN
  PERFORM 1 FROM profiles WHERE id = p_profile FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Choose at least one person';
  END IF;
  IF p_own_share IS NULL OR p_own_share < 0 OR p_own_share <> round(p_own_share, 2) THEN
    RAISE EXCEPTION 'Invalid own share';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    a := (r->>'amount')::numeric;
    description := trim(r->>'description');
    IF a IS NULL OR a <= 0 OR a <> round(a, 2) OR description IS NULL OR description = ''
      OR r->>'direction' IS NULL OR r->>'direction' NOT IN ('they_owe_me','i_owe_them') THEN
      RAISE EXCEPTION 'Invalid tab amount or description';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM people WHERE id = (r->>'person_id')::uuid AND profile_id = p_profile) THEN
      RAISE EXCEPTION 'Person does not belong to this account';
    END IF;
    INSERT INTO debts(profile_id, person_id, direction, amount, remaining_amount, description)
    VALUES(p_profile, (r->>'person_id')::uuid, r->>'direction', a, a, description);
    IF r->>'direction' = 'they_owe_me' THEN outgoing := outgoing + a; END IF;
  END LOOP;
  IF p_own_share > 0 THEN
    INSERT INTO expenses(profile_id, reason, amount, notes)
    VALUES(p_profile, description, p_own_share, 'Your share of a split payment');
  END IF;
  UPDATE profiles SET balance = coalesce(balance,0) - outgoing - p_own_share WHERE id = p_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_tab(p_profile uuid, p_person uuid, p_payment numeric,
  p_expected_collect numeric, p_expected_pay numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE collect numeric; pay numeric; offset_amount numeric; consume numeric;
  direction_name text; d record; used numeric; person_name text;
BEGIN
  PERFORM 1 FROM profiles WHERE id = p_profile FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT name INTO person_name FROM people WHERE id = p_person AND profile_id = p_profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Person not found'; END IF;
  PERFORM 1 FROM debts WHERE profile_id = p_profile AND person_id = p_person FOR UPDATE;
  SELECT coalesce(sum(remaining_amount) FILTER (WHERE direction = 'they_owe_me'),0),
    coalesce(sum(remaining_amount) FILTER (WHERE direction = 'i_owe_them'),0)
    INTO collect, pay FROM debts WHERE profile_id = p_profile AND person_id = p_person;
  IF collect IS DISTINCT FROM p_expected_collect OR pay IS DISTINCT FROM p_expected_pay THEN
    RAISE EXCEPTION 'This tab changed. Close and reopen it before recording payment.';
  END IF;
  IF p_payment IS NULL OR p_payment < 0 OR p_payment <> round(p_payment,2)
    OR p_payment > abs(collect-pay) OR (p_payment = 0 AND (collect <> pay OR collect = 0)) THEN
    RAISE EXCEPTION 'Enter a payment up to the net amount';
  END IF;
  offset_amount := least(collect,pay);
  FOREACH direction_name IN ARRAY ARRAY['they_owe_me','i_owe_them'] LOOP
    consume := offset_amount + CASE WHEN (direction_name = 'they_owe_me' AND collect > pay)
      OR (direction_name = 'i_owe_them' AND pay > collect) THEN p_payment ELSE 0 END;
    FOR d IN SELECT * FROM debts WHERE profile_id = p_profile AND person_id = p_person
      AND direction = direction_name AND remaining_amount > 0 ORDER BY created_at, id LOOP
      EXIT WHEN consume <= 0;
      used := least(consume,d.remaining_amount);
      UPDATE debts SET remaining_amount = remaining_amount-used,
        settled_at = CASE WHEN remaining_amount-used = 0 THEN now() ELSE NULL END WHERE id = d.id;
      consume := consume-used;
    END LOOP;
  END LOOP;
  UPDATE profiles SET balance = coalesce(balance,0) + CASE WHEN collect > pay THEN p_payment ELSE -p_payment END
    WHERE id = p_profile;
  IF pay > collect AND p_payment > 0 THEN
    INSERT INTO expenses(profile_id,reason,amount,notes)
    VALUES(p_profile,'Tab payment — ' || person_name,p_payment,'Payment recorded from Tabs');
  END IF;
END;
$$;

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
