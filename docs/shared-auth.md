# Shared Firebase accounts

One Firebase project owns email/password accounts. One Firestore database reserves usernames. Each app has its own Supabase project for its own data. Expensive hosts the initial identity API at `https://expensive.itsbypranav.com`.

Sign-in uses email and password. The username is a shared account name, not a second login method. Users verify their email before choosing a username or accessing financial data. Names are lowercase, 3–24 characters, start with a letter, and contain letters, numbers, or underscores. They cannot currently be renamed or recycled.

## 1. Configure Firebase once

1. Create a Firebase project for your shared identity, and register a **Web app**. Copy its `apiKey`, `projectId`, `authDomain`, and `appId` into the corresponding `NEXT_PUBLIC_FIREBASE_*` values in the root `.env`. Use [.env.example](../.env.example) as the reference; keep your existing Supabase values.
2. Enable **Authentication → Sign-in method → Email/Password**. Enable email enumeration protection and set a required minimum password length of **12** in the password policy. The UI also checks this, but Firebase must enforce it.
3. Add `expensive.itsbypranav.com` and your development hostname to Authentication's authorized domains. Add future app domains here too.
4. Create the **default Cloud Firestore database**, Standard edition, in production mode. Publish [firestore.rules](../firebasef/firestore.rules) in its Rules tab. All client access is denied; the trusted identity server performs transactions through Firebase Admin. No extra indexes are needed.
5. In Project settings → Service accounts, generate a private service account key. Put only its `project_id`, `client_email`, and `private_key` into server environment variables `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Store the private key as a quoted value with `\n` escapes locally, or actual multiline text in your host's secret settings. Never commit the JSON file or ship it in iOS.
6. In Authentication → Templates, set the custom action URL for verification and password reset emails to `https://expensive.itsbypranav.com/auth/action`. This page handles Firebase's `mode` and `oobCode` parameters in your theme. Keep the default Firebase action handler until this route is deployed.

The web SDK and native REST client both use Firebase Auth. Native iOS currently uses the public **Web API key** with the Firebase REST API; it does not need a `GoogleService-Info.plist`. A browser-referrer-only key restriction will block native requests. Restrict the key to the needed Identity Toolkit and Token Service APIs and test both clients.

## 2. Configure this app's server

Set these values locally and on the deployed Next.js host:

```dotenv
NEXT_PUBLIC_IDENTITY_URL=https://expensive.itsbypranav.com
NEXT_PUBLIC_APP_URL=https://expensive.itsbypranav.com
IDENTITY_ALLOWED_ORIGINS=https://expensive.itsbypranav.com,http://localhost:3000
```

Add `SUPABASE_SERVICE_ROLE_KEY` for **Expensive's** Supabase project, alongside the existing public Supabase URL/key. It is used only by `/api/auth/bootstrap` to attach a verified identity to an app account. Normal expense requests use the user's Firebase token and remain subject to RLS. The server and client Firebase project IDs must match.

For local development, set `NEXT_PUBLIC_IDENTITY_URL=http://localhost:3000` so the web app uses the local identity routes. The native app requires HTTPS URLs; use the deployed service or an HTTPS development endpoint for device testing.

### Resend email delivery

Set `RESEND_API_KEY` on the server and `AUTH_EMAIL_FROM="Expensive <expensive@itsbypranav.com>"`. Verify `itsbypranav.com` in Resend. Supabase's old SMTP settings do not carry over to Firebase.

With a Resend key, `/api/identity/email` generates Firebase verification/reset **links** and sends them through Resend. The subject and body are editable in that route. Without a Resend key, clients use Firebase's built-in email delivery. This flow replaces numeric email sign-in codes with a password plus verification link.

Delivery is limited to one request per address per minute, five per hour, and `AUTH_EMAIL_DAILY_LIMIT` messages total per UTC day (default **90**). Raise this deliberately as usage grows and your sender's plan permits. Reset requests always return a generic message for missing accounts or exhausted limits. Optional Firestore TTL on `emailLimits.expiresAt` can clean up limiter records; check billing requirements before enabling TTL. Keep current records if cleaning up manually.

## 3. Migrate Expensive's existing database

This migration is for the installed **multi-user Expensive schema**, including `profiles.user_id`, `categories.user_id`, and the existing Tabs/transfer RPCs. It is not a fresh database installer.

1. Take a database backup. Check that your existing profiles/categories already have the intended owner UUID and that the original user's email is verified in Supabase Auth. For your data, that email is `pranavreddymitta@gmail.com`. Resolve any unowned rows before switching auth.
2. Apply [native-operations.sql](../ios/Database/native-operations.sql) if it is not installed.
3. In Supabase → Authentication → Third-party Auth, add **Firebase**, using the shared Firebase project ID.
4. In [supabase-firebase-migration.sql](../supabase-firebase-migration.sql), replace `YOUR_FIREBASE_PROJECT_ID` with that exact ID, then run the file in Supabase SQL Editor.
5. Deploy this web build and rebuild the iOS app as the same release. The migration deliberately authorizes Firebase identities; old Supabase sessions will need to sign in through the new flow.

The migration snapshots verified legacy emails and retains all existing UUIDs, expenses, balances, and categories. On first verified Firebase sign-in, the trusted server links the matching legacy email once. A second Firebase account cannot take that mapping, and later email changes cannot claim another legacy account. Newly registered users get a new private app UUID and default categories. Firebase's string UID remains the shared identity across apps.

Because the old flow had no password, existing users choose **create account**, use their existing email, set a password, verify the email, and choose a username. If they already have a Firebase account in this project, they simply sign in. Password reset is for accounts that already exist in Firebase.

The mapping is stored in `app_private.firebase_accounts`; clients cannot edit it. Do not copy users into `auth.users`, share Supabase signing secrets, or place server keys in either client. The SQL is rerunnable for the same Firebase project; changing that project later requires a separate account migration.

## 4. Run web and iOS

```sh
npm install
npm run dev
```

For native iOS, set the public Firebase key and HTTPS service URLs in `.env`, then regenerate the ignored native configuration:

```sh
node ios/scripts/configure.mjs --force
```

Open `ios/Expensive.xcodeproj`, select your signing team, and Run. Firebase refresh tokens are stored in Keychain. Passwords are never stored by the app. A new Keychain account name keeps old Supabase sessions separate from Firebase sessions.

## 5. Connect another app

1. Register that app in the **same Firebase project**. It shares the users. Give the app its own Supabase project and enable that project's Firebase third-party integration using the same project ID.
2. Use Firebase's SDK for that platform, with custom email/password forms. Require verified email. Point the app's identity API URL at `https://expensive.itsbypranav.com` and add its web origin to the identity host's `IDENTITY_ALLOWED_ORIGINS`.
3. After sign-in, call `GET /api/identity` with `Authorization: Bearer <Firebase ID token>`. If `needsUsername` is true, ask for a name and call `POST /api/identity` with `{ "username": "chosen_name" }`. When `refreshToken` is true, force-refresh the Firebase ID token. The identity service sets the `role: authenticated` custom claim needed by Supabase. Call the identity service before making data queries on a new account.
4. Configure the app's Supabase client to use the Firebase ID token. Use the **new app's Supabase URL and public key**:

```js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(appSupabaseURL, appSupabasePublicKey, {
  accessToken: async () => {
    await auth.authStateReady();
    return auth.currentUser?.getIdToken() ?? null;
  },
});
```

5. Add RLS for that app's own tables. For a new app, store the Firebase UID as **text** directly. For example, adapt this to your table and replace `YOUR_PROJECT_ID`:

```sql
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid text NOT NULL DEFAULT (auth.jwt()->>'sub'),
  body text NOT NULL
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
CREATE POLICY own_notes ON public.notes FOR ALL TO authenticated
USING (
  owner_uid = (SELECT auth.jwt()->>'sub')
  AND (SELECT auth.jwt()->>'iss') = 'https://securetoken.google.com/YOUR_PROJECT_ID'
  AND (SELECT auth.jwt()->>'aud') = 'YOUR_PROJECT_ID'
  AND (SELECT auth.jwt()->>'email_verified') = 'true'
)
WITH CHECK (
  owner_uid = (SELECT auth.jwt()->>'sub')
  AND (SELECT auth.jwt()->>'iss') = 'https://securetoken.google.com/YOUR_PROJECT_ID'
  AND (SELECT auth.jwt()->>'aud') = 'YOUR_PROJECT_ID'
  AND (SELECT auth.jwt()->>'email_verified') = 'true'
);
```

Firebase UIDs are not UUIDs: use `auth.jwt()->>'sub'`, not `auth.uid()`. Expensive's mapping function exists specifically to preserve its older UUID ownership. Do not run Expensive's migration in an unrelated app's database.

6. Use `POST /api/identity/email` with `{ "kind": "verify" }` and a bearer token, or `{ "kind": "reset", "email": "..." }` without a token. If it returns `useFirebaseEmail: true`, call the Firebase SDK's email method. Verification/reset links return to the central action page; users then return to the app where they started.
7. On logout/account changes, clear app caches, unsubscribe from live data, and sign out through Firebase. Test with two users to confirm that one cannot access the other's rows. Expensive's web cache uses tab-session storage with a one-hour restore limit; iOS uses file-protected, disposable snapshots with a 24-hour limit. Returning launches can show a **read-only local preview** before online validation completes. Web previews must match the restored Firebase UID/email; native previews must match the Keychain user's ID. Controls and financial reads remain blocked until validation succeeds, and failure removes the preview. Cached values may be stale until background refresh finishes. Logout and financial changes clear/invalidate snapshots; financial snapshots are not stored in localStorage. Startup responses include `Server-Timing` for auth, identity and database phases to help diagnose remaining deployment/network latency.

### Web and iOS feature parity update

The web app now uses the same `ios_add_expense`, `ios_move_expense`, `ios_delete_expense`, and `ios_add_tabs` RPCs as iOS, plus `adjust_balance`, `record_tab_payment`, and `undo_tab_payment`. Despite their names, the `ios_*` RPCs serve both clients. Ensure [native-operations.sql](../ios/Database/native-operations.sql) was installed **before** the Firebase migration, and [activity-history.sql](../ios/Database/activity-history.sql) **after** it. If these were already installed for iOS, no new SQL is needed. Do not reinstall native-operations.sql alone after Firebase: its legacy auth references require the Firebase migration afterward.

New payments from either app appear in the shared history; older unlogged settlements cannot be undone. Undo safely refuses if the tab or its generated expense has changed. Theme/currency are device preferences, not cross-device settings, and currency selection never converts money. Redeploy the web app to activate the new screens.

Only the identity host needs Firestore Admin credentials or the Resend key. A new app that stores Firebase UIDs directly can use the central API and Supabase integration without deploying its own identity server. If it needs private backend endpoints, verify Firebase tokens server-side with Firebase Admin or an appropriate verifier.

Shared credentials work across all apps. Browser sessions on separate domains and separate native apps remain separate; automatic cross-domain SSO is not implemented. Deleting or disabling the central account affects all apps; account deletion/username release needs a coordinated server process and is not exposed in this UI. Existing ID tokens can remain valid at Supabase until expiry, even after Firebase revocation; backend bootstrap checks revocation immediately.

## Check before enabling the release

Run `npm test`, `npm run build`, and Xcode's Product → Test. Automated tests cover isolation, migration, money operations, and username reservation behavior. Then verify against your configured services: signup → email link → username → original data, duplicate username rejection, wrong-password handling, password reset, native restart/session refresh, logout, and a second user's isolated data.

The code does not create cloud projects, deploy Firestore rules, enable the Supabase integration, or execute production SQL automatically. Firebase, Firestore, your host, Resend, and Supabase have independent quotas; review them as usage grows.

References: [Firebase with Supabase](https://supabase.com/docs/guides/auth/third-party/firebase-auth), [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firebase custom email links](https://firebase.google.com/docs/auth/admin/email-action-links).
