-- Run after supabase-trips.sql. Existing trips have no personal budget set.
BEGIN;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS personal_budget numeric NOT NULL DEFAULT 0
 CHECK(personal_budget>=0 AND personal_budget<10000000000 AND personal_budget=round(personal_budget,2));
CREATE OR REPLACE FUNCTION public.save_trip_budgets(p_id uuid,p_profile uuid,p_name text,p_budget numeric,p_personal_budget numeric,p_start date,p_end date,p_people uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_personal_budget IS NULL OR p_personal_budget<0 OR p_personal_budget>=10000000000 OR p_personal_budget<>round(p_personal_budget,2) THEN
  RAISE EXCEPTION 'Enter a valid personal budget';
 END IF;
 PERFORM public.save_trip(p_id,p_profile,p_name,p_budget,p_start,p_end,p_people);
 UPDATE public.trips SET personal_budget=p_personal_budget WHERE id=p_id AND user_id=public.current_app_user_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_trip_budgets(uuid,uuid,text,numeric,numeric,date,date,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_trip_budgets(uuid,uuid,text,numeric,numeric,date,date,uuid[]) TO authenticated;
COMMIT;
