-- Run once in Supabase SQL Editor against your existing people/debts schema.
-- Existing balances and debts are intentionally not recalculated.
BEGIN;

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

-- One person, one net payment. Opposite open amounts cancel each other first.
-- Expected totals prevent a stale browser or a repeated click settling twice.
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
COMMIT;
