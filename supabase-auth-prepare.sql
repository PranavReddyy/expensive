-- Stage 1: additive, leaves Firebase sign-in working. Back up first.
BEGIN;
CREATE TABLE IF NOT EXISTS app_private.supabase_usernames (
 username text PRIMARY KEY CHECK(username ~ '^[a-z][a-z0-9_]{2,23}$'),
 user_id uuid NOT NULL UNIQUE REFERENCES app_private.app_accounts(id)
);
REVOKE ALL ON app_private.supabase_usernames FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.auth_migration_accounts()
RETURNS TABLE(firebase_uid text,app_user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT firebase_uid,app_user_id FROM app_private.firebase_accounts ORDER BY app_user_id
$$;
CREATE OR REPLACE FUNCTION public.auth_migration_username(p_id uuid,p_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified Supabase user required'; END IF;
 INSERT INTO app_private.supabase_usernames(username,user_id) VALUES(p_username,p_id)
 ON CONFLICT(user_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM app_private.supabase_usernames WHERE user_id=p_id AND username=p_username) THEN RAISE EXCEPTION 'Username mismatch'; END IF;
 UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('username',p_username) WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.auth_migration_accounts() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.auth_migration_username(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auth_migration_accounts(),public.auth_migration_username(uuid,text) TO service_role;
COMMIT;
