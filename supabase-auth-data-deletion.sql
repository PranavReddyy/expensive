-- Run AFTER supabase-expense-upgrades.sql. Defines an operation; deletes nothing on install.
-- Apply AFTER supabase-auth-cutover.sql. Server verifies recent Supabase sign-in.
BEGIN;
CREATE OR REPLACE FUNCTION public.delete_expensive_data(p_owner uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=p_owner;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Invalid account'; END IF;
 PERFORM id FROM public.profiles WHERE user_id=owner ORDER BY id FOR UPDATE;
 DELETE FROM public.account_activity WHERE user_id=owner;
 DELETE FROM public.recurring_expenses WHERE user_id=owner;
 DELETE FROM public.profile_transfers WHERE from_profile IN(SELECT id FROM public.profiles WHERE user_id=owner)
 OR to_profile IN(SELECT id FROM public.profiles WHERE user_id=owner);
 DELETE FROM public.debts WHERE profile_id IN(SELECT id FROM public.profiles WHERE user_id=owner);
 DELETE FROM public.people WHERE profile_id IN(SELECT id FROM public.profiles WHERE user_id=owner);
 DELETE FROM public.expenses WHERE profile_id IN(SELECT id FROM public.profiles WHERE user_id=owner);
 DELETE FROM public.profiles WHERE user_id=owner;
 DELETE FROM public.categories WHERE user_id=owner;
 -- Retain only opaque request IDs, not financial payloads, to reject late retries.
 UPDATE public.expense_requests SET payload='{"deleted":true}'::jsonb WHERE user_id=owner;
 UPDATE public.ios_tab_requests SET payload='{"deleted":true}'::jsonb WHERE user_id=owner;
 -- Keep the identity link so this cannot delete/reclaim another app's login.
 UPDATE app_private.app_accounts SET legacy_email=NULL WHERE id=owner;
END $$;
REVOKE ALL ON FUNCTION public.delete_expensive_data(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expensive_data(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_expensive_data(text,text) FROM service_role;
COMMIT;
