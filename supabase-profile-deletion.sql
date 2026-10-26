-- Apply after the auth cutover and expense upgrades. Defines an operation only.
BEGIN;
CREATE OR REPLACE FUNCTION public.delete_profile(p_profile uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid := public.current_app_user_id(); item public.profiles;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 -- Match the lock order used by transfers and account deletion.
 PERFORM id FROM public.profiles WHERE user_id=owner ORDER BY id FOR UPDATE;
 SELECT * INTO item FROM public.profiles WHERE id=p_profile AND user_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
 IF p_name IS DISTINCT FROM item.name THEN RAISE EXCEPTION 'Type the exact profile name to confirm'; END IF;
 IF EXISTS(SELECT 1 FROM public.debts WHERE profile_id=p_profile AND remaining_amount>0) THEN
  RAISE EXCEPTION 'Settle this profile’s open Tabs before deleting it';
 END IF;
 DELETE FROM public.account_activity WHERE profile_id=p_profile AND user_id=owner;
 DELETE FROM public.recurring_expenses WHERE profile_id=p_profile AND user_id=owner;
 DELETE FROM public.profile_transfers WHERE from_profile=p_profile OR to_profile=p_profile;
 DELETE FROM public.debts WHERE profile_id=p_profile;
 DELETE FROM public.people WHERE profile_id=p_profile;
 DELETE FROM public.expenses WHERE profile_id=p_profile;
 DELETE FROM public.profiles WHERE id=p_profile AND user_id=owner;
 -- Keep retry receipts: a late offline request must never recreate this profile.
END $$;
REVOKE ALL ON FUNCTION public.delete_profile(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_profile(uuid,text) TO authenticated;
COMMIT;
