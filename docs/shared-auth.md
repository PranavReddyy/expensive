# Shared Firebase accounts

One Firebase project owns email/password accounts. One Firestore database reserves usernames. Each app has its own Supabase project for its own data. Expensive hosts the initial identity API at `https://expensive.itsbypranav.com`.

Sign-in accepts **username or email + password**. Signup checks username availability; users verify their email and confirm the name before it is permanently reserved or financial data is accessible. Names are lowercase, 3–24 characters, start with a letter, and contain letters, numbers, or underscores. They cannot currently be renamed or recycled. Availability is a hint; the final transaction prevents two accounts claiming the same name.

## 1. Configure Firebase once

1. Create a Firebase project for your shared identity, and register a **Web app**. In the root `.env`, map its `apiKey` to `NEXT_PUBLIC_FIREBASE_API_KEY`, `projectId` to `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `authDomain` to `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, and `appId` to `NEXT_PUBLIC_FIREBASE_APP_ID`. Keep your existing Supabase values.
2. Enable **Authentication → Sign-in method → Email/Password**. Enable email enumeration protection and set a required minimum password length of **12** in the password policy. The UI also checks this, but Firebase must enforce it.
3. Add `expensive.itsbypranav.com` and your development hostname to Authentication's authorized domains. Add future app domains here too.
4. Create the **default Cloud Firestore database**, Standard edition, in production mode. Publish [firestore.rules](../firebase/firestore.rules) in its Rules tab. All client access is denied; the trusted identity server performs transactions through Firebase Admin. No extra indexes are needed.
5. In Project settings → Service accounts, generate a private service account key. Put only its `project_id`, `client_email`, and `private_key` into server environment variables `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Store the private key as a quoted value with `\n` escapes locally, or actual multiline text in your host's secret settings. Never commit the JSON file or ship it in iOS.
6. Deploy `/auth/action` on the identity service before sending emails. The server builds links on `NEXT_PUBLIC_IDENTITY_URL` itself, so changing Firebase's email-template action URL is **not required** for this Resend flow. Firebase only issues and validates the single-use code; its default template and hosted verification page are not used.

The current iOS app calls the [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth) using the public Web API key. **The Firebase Web app registration is sufficient for this implementation:** you do not need to register a separate iOS app or add `GoogleService-Info.plist` for its email/password authentication. The native app also needs the HTTPS identity service running, where Resend and the server credentials live.

If you later adopt the Firebase Apple SDK, Crashlytics, Analytics, or other native Firebase integrations, [register an Apple app](https://firebase.google.com/docs/ios/setup) in the **same Firebase project**, using the bundle ID in Xcode, and follow that SDK's configuration steps. It will share the existing users. A browser-referrer-only API key restriction will block the current native REST requests; restrict the key to Identity Toolkit and Token Service APIs and test both clients.

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

`/api/identity/email` obtains a Firebase verification/reset code, builds an **own-domain link**, and sends a custom monochrome HTML email plus a plain-text fallback through Resend, from `expensive@itsbypranav.com`. Edit the subject and template in [account-email.mjs](../lib/identity/account-email.mjs). No Firebase email template is used. `RESEND_API_KEY` is required on the deployed identity server. Both clients report an error if delivery is unavailable; they do not fall back to Firebase's email sender. This flow uses a password plus verification link rather than numeric sign-in codes.

New links use `https://expensive.itsbypranav.com/auth/action#mode=…&oobCode=…`. The fragment keeps the code out of HTTP request URLs and referrers; the page removes it from browser history after reading it. The code retains Firebase's expiry and single-use validation. The handler also accepts older query-string links. Set `NEXT_PUBLIC_IDENTITY_URL` to the deployed custom domain, not `*.firebaseapp.com`. In Resend, disable click tracking for authentication emails so tracking redirects do not wrap these security-sensitive links. Existing emails cannot be changed: deploy this release, then request a new email.

Delivery is limited to one request per address per minute, five per hour, and `AUTH_EMAIL_DAILY_LIMIT` messages total per UTC day (default **90**). Raise this deliberately as usage grows and your sender's plan permits. Reset requests always return a generic message for missing accounts or exhausted limits. Optional Firestore TTL on `emailLimits.expiresAt` can clean up limiter records; check billing requirements before enabling TTL. Keep current records if cleaning up manually.

Rejected sends and link-generation failures refund their allowance. Ambiguous network timeouts retain it to prevent duplicate sends. Server logs include only the failing stage/provider code, never addresses, action links, tokens, or passwords. A successful send means Resend accepted it; use Resend's delivery events to diagnose spam, bounces, or inbox delivery.

`/api/identity/login` verifies the password with Firebase before returning a custom token, without exposing a username's email publicly. `/api/identity/username?username=...` checks availability. Public requests have Firestore-backed per-IP limits (15 login attempts and 60 availability checks per minute on Vercel). Optional TTL on `authLimits.expiresAt` cleans up old records. Outside Vercel, the limiter conservatively uses one shared bucket; adapt the trusted proxy IP source before deploying on another host.

### If identity routes crash before sending

The scoped `jwks-rsa → jose@5.10.0` override in `package.json` keeps Firebase Admin compatible with Vercel's CommonJS loader. Without it, `ERR_REQUIRE_ESM` can crash even `OPTIONS /api/identity/email` before Resend runs. Keep the lockfile and run `npm ci` on deploy. The test suite loads Firebase Admin with `require(esm)` disabled to catch regressions. Do not remove the override until the upstream dependency/runtime combination has been verified.

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

Follow the separate [Connect another app](connect-another-app.md) guide. It includes Firebase registration, Supabase configuration, working web examples, email endpoints, and iOS options.

## Check before enabling the release

Run `npm test`, `npm run build`, and Xcode's Product → Test. Automated tests cover isolation, migration, money operations, and username reservation behavior. Then verify against your configured services: signup → email link → username → original data, duplicate username rejection, wrong-password handling, password reset, native restart/session refresh, logout, and a second user's isolated data.

The code does not create cloud projects, deploy Firestore rules, enable the Supabase integration, or execute production SQL automatically. Firebase, Firestore, your host, Resend, and Supabase have independent quotas; review them as usage grows.

References: [Firebase with Supabase](https://supabase.com/docs/guides/auth/third-party/firebase-auth), [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firebase custom email links](https://firebase.google.com/docs/auth/admin/email-action-links).
