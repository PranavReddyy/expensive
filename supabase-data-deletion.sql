-- Run AFTER supabase-expense-upgrades.sql. Defines an operation; deletes nothing on install.
-- Only the trusted server may call it after recent Firebase reauthentication.
BEGIN;
CREATE OR REPLACE FUNCTION public.delete_expensive_data(p_uid text,p_project text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_private.firebase_config WHERE project_id=p_project) THEN RAISE EXCEPTION 'Invalid identity'; END IF;
 SELECT app_user_id INTO owner FROM app_private.firebase_accounts WHERE firebase_uid=p_uid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
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
REVOKE ALL ON FUNCTION public.delete_expensive_data(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expensive_data(text,text) TO service_role;
COMMIT;
