# Supabase-only sign-in

## Live migration status — 15 October 2026

The `spenditall` project (`ttzcbcgpxeldgkgeldap`) has been migrated: three account IDs and usernames were preserved, Supabase-only authorization is installed, and the production web client uses Supabase Auth. Resend SMTP and the custom confirmation/recovery templates are configured. The four profile balances matched the protected pre-cutover backup exactly. Existing users need one password reset using their original email; do not register a replacement account.

The backup is outside the repository under `/Users/Pranav/Downloads/expensive-backups/auth-cutover-G6W0ke/`. Keep it private. The steps below remain as an operator reference, not a request to rerun the migration.

Expensive now uses its own Supabase email/password accounts and unique usernames. Email sign-in goes straight to Supabase; username sign-in uses one private server lookup. Firebase/Firestore are no longer in the app's sign-in, refresh, or data paths. Resend still delivers the email through Supabase's custom SMTP.

## Existing installation: safe cutover

These are operator steps, not steps every user must follow. The build does **not** apply SQL, import users, or change live auth settings automatically. Do not distribute the new clients before the cutover is ready.

1. Back up the database and export the existing Firebase accounts/username reservations. Keep the current production app available while preparing. Check your database's existing auth-user triggers before import: any custom trigger must support the preserved UUIDs and `app_private.app_accounts` foreign keys. This migration targets the existing Firebase-enabled schema and upgrades, not an empty database.
2. Run [supabase-auth-prepare.sql](../supabase-auth-prepare.sql). It is additive; Firebase keeps working.
3. Keep the old Firebase **server** credentials locally just for the migration. Fill `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` locally. Never paste them into chat, commit them, or copy the service key into a native build.
4. Run a read-only preflight:

   ```sh
   node scripts/migrate-supabase-auth.mjs
   ```

   It checks every app-mapped Firebase user against Supabase. Different emails/UUID conflicts, unverified/disabled accounts, or missing usernames stop the run for manual review. It never guesses ownership from a client-supplied email. All checks finish before writes begin.

5. During a short maintenance window, pause new registrations and rerun with `--apply`:

   ```sh
   node scripts/migrate-supabase-auth.mjs --apply
   ```

   Existing verified Supabase users keep their UUID; missing users are created with the **same app UUID**, verified email and a random unknown password. Usernames become private Supabase reservations and server-controlled metadata. The script is rerunnable, does not send emails, and never changes balances, expenses or outbox entries. Resolve any failure before proceeding. Do not create replacement accounts with different IDs.

6. Enable Supabase **Email/password** with **Confirm email** on and a minimum 12-character password. Set Site URL to `https://expensive.itsbypranav.com` and allow `https://expensive.itsbypranav.com/auth/action` as a redirect. Configure Resend and the templates below.
7. In [supabase-auth-cutover.sql](../supabase-auth-cutover.sql), replace `YOUR_SUPABASE_URL` with the exact existing project URL (no trailing slash), then run it. It refuses to proceed if a mapped account has not been imported. It changes `current_app_user_id()` to accept only that project's verified Supabase users, preserving existing ownership/RLS and rejecting Firebase tokens. Run [supabase-auth-data-deletion.sql](../supabase-auth-data-deletion.sql) after it; the existing expense-upgrades/activity-history/data-deletion migrations must already be installed.
8. Deploy web and rebuild iOS together. Run `node ios/scripts/configure.mjs --force`; only public Supabase settings and the app URL are now copied. Install as an **update**, never uninstall: pending expense drafts must stay on the devices. Watch continues using the phone session.
9. Existing users choose **forgot password**, enter their original email, set a new password, then sign in. For the original account, use `pranavreddymitta@gmail.com`. This is a one-time migration; do not create a new account to recover existing data.
10. Verify the checklist below. Disable the Firebase third-party integration in Supabase, remove `FIREBASE_*`, `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_IDENTITY_URL` and `IDENTITY_ALLOWED_ORIGINS` from deployment settings, and revoke the obsolete Firebase service-account key. Keep the database backup/private legacy mapping for rollback until accepted. `firebase-admin` is a dev-only dependency solely for the migration script; remove the script/dependency after the rollback window. No Firebase SDK ships in the web or native app.

Do not rerun `supabase-firebase-migration.sql` after cutover: it would restore the old authorization function. Roll back the code and the ownership function/configuration together from reviewed backups if needed; never overwrite new financial rows with an old snapshot.

## Resend emails, on your domain

In Supabase Authentication → Email → SMTP, use the Resend integration or custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password your Resend API key, sender `expensive@itsbypranav.com`, sender name `Expens***`. The domain must already be verified in Resend. Turn off link tracking for auth messages. Supabase, not the Next.js server, sends signup/reset emails.

Paste [email-confirm.html](email-confirm.html) into **Confirm signup** and [email-reset.html](email-reset.html) into **Reset password**. These link to your own `/auth/action` handler using Supabase's single-use token hash, not a Firebase verification page. Set the Site URL to the app root (not `/auth/action`). These templates also work for native signup/reset, opening the web handler; return to iPhone and sign in afterward.

References: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Resend SMTP](https://resend.com/changelog/smtp-service).

## Speed and offline behavior

- Returning sessions render local data without a Firebase/Firestore/bootstrap request. Supabase refreshes tokens as needed; every remote operation still uses authenticated RLS. This removes extra round trips, not internet latency.
- iPhone restores its Keychain session and owner-scoped snapshot, then refreshes in the background. Web keeps owner-scoped views in browser local storage for up to 24 hours and caches only public app shells/static assets in the service worker. Neither caches API responses in the service worker. Sign-out clears the financial view cache. Use a trusted, device-locked browser; browser storage is not an encrypted vault.
- Visit the web screens online once after deployment to cache their shells. Offline navigation works only for cached screens/assets; a first visit, cleared storage, private-mode storage restrictions or a new deployment can require a connection. Native also needs an initial successful sign-in and profile load.
- Expense submissions are saved locally first with their original account/profile/category and stable request UUID. They retry when online and signed into the same account. Server receipts prevent duplicate deductions. Pending is **not** server-confirmed, and cached balances can be stale. Keep the app open to sync; background delivery is not guaranteed.
- Offline support covers **new expenses**, not transfers, balance edits, tab settlements or account deletion. Those remain online-only. Watch keeps one unacknowledged draft and retries through the paired phone; it is not a standalone network client.
- Expired/revoked sessions cannot sync. Drafts remain on their original account until successful sign-in; do not clear storage/uninstall while drafts are pending.

## Release checks

Run `npm test`, `npm run build`, and Xcode tests. On a staging copy first, test two users: reset → sign in by email and username → original balances; signup → custom Resend verification → unique username; rejected/expired reset links; offline cold launch after a previous sign-in; expense queued offline → reconnect → exactly one deduction; logout/account switch with pending drafts; iPhone/Watch profile/category selection; deletion only after recent password sign-in. Compare actual startup timings before/after. Automated tests cannot prove deployed SMTP delivery or device connectivity.
