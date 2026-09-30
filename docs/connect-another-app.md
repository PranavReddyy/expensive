# Connect another app to the shared accounts

Use the same Firebase project as Expensive for authentication and the same identity service for usernames and emails. Give the new app its own Supabase project for its data.

The identity service is **https://expensive.itsbypranav.com**. It must be deployed and configured using [shared-auth.md](shared-auth.md) before another app can use it.

## 1. Register the new app

In the existing Firebase project, open **Project settings → Your apps → Add app**.

- **Web / Next.js:** register a Web app and copy its public configuration. Add its production domain and development hostname under Authentication → Settings → Authorized domains.
- **iOS with the Firebase Apple SDK:** register an Apple app using its exact Xcode bundle ID, then add its `GoogleService-Info.plist` and Firebase Auth SDK. Use the same Firebase project so the accounts are shared.
- **iOS using Expensive's REST approach:** the Firebase project's public Web API key is sufficient for email/password requests; an Apple app registration and plist are not required by this implementation. Copy the Keychain/session handling as well as the API calls if reusing it.

Do not create a second Firebase project for the new app's accounts. Users who already registered in another app should sign in with their existing email/password.

## 2. Allow the new website to call the identity service

On the **Expensive identity server**, append the new website's exact origin to `IDENTITY_ALLOWED_ORIGINS`, preserving the existing entries, then redeploy it:

```dotenv
IDENTITY_ALLOWED_ORIGINS=https://expensive.itsbypranav.com,https://newapp.example.com,http://localhost:3000
```

Use origins with scheme and optional port, without paths or a trailing slash. Add preview domains explicitly if needed. Native HTTP clients do not use browser CORS and do not need an origin entry.

The shared server keeps Firebase Admin credentials, the Firestore username registry, `RESEND_API_KEY`, and the verified email sender. Do not copy these secrets into the new app's browser or iOS bundle. The new app does not need its own Resend key.

## 3. Connect the new Supabase project

Create the new app's Supabase project. In **Authentication → Third-party Auth**, add **Firebase** using the existing shared Firebase project ID. Copy this new project's public URL and publishable/anon key into the new app.

For a Web app, install:

```sh
npm install firebase @supabase/supabase-js
```

Example environment for a Next.js client (all values here are public configuration):

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=the-shared-project-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=the-shared-firebase-project-id
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=the-shared-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_APP_ID=the-new-web-app-id
NEXT_PUBLIC_IDENTITY_URL=https://expensive.itsbypranav.com
NEXT_PUBLIC_SUPABASE_URL=https://the-new-app-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=the-new-app-public-key
```

For other frameworks, use their public environment mechanism. Keep server credentials out of any public environment variables.

## 4. Initialize the clients

Use this module only in the browser, for example `lib/accounts.js` in a Next.js app:

```js
'use client';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { createClient } from '@supabase/supabase-js';

const firebase = getApps().length ? getApp() : initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
export const auth = getAuth(firebase);
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    accessToken: async () => {
      await auth.authStateReady();
      return auth.currentUser?.getIdToken() ?? null;
    },
  },
);

export async function identityRequest(path, { method = 'GET', body, authenticated = true } = {}) {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (authenticated && !user) throw new Error('Please sign in.');
  const response = await fetch(process.env.NEXT_PUBLIC_IDENTITY_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: 'Bearer ' + await user.getIdToken() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
  if (result.refreshToken && user) await user.getIdToken(true);
  return result;
}
```

## 5. Add signup, verification, and sign-in

Use your own forms and styling. The sequence is:

1. Create the Firebase account with email/password, or sign in to the existing one.
2. Send a verification email through the identity service when needed.
3. After the user opens the email link, reload the Firebase user and refresh their ID token.
4. Load the shared username, or ask the user to choose one.
5. Begin Supabase queries after identity setup completes.

Example functions using the module above:

```js
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  reload, signOut,
} from 'firebase/auth';
import { auth, supabase, identityRequest } from './accounts';

export async function signUp(email, password) {
  if (password.length < 12) throw new Error('Use at least 12 characters.');
  await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  // The account already exists if email delivery fails; offer resend, not signup again.
  await resendVerification();
}

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return finishSignIn();
}

export async function resendVerification() {
  const result = await identityRequest('/api/identity/email', {
    method: 'POST', body: { kind: 'verify' },
  });
  if (result.sent !== true) throw new Error('Email delivery is unavailable.');
}

export async function finishSignIn() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in.');
  await reload(user);
  await user.getIdToken(true);
  if (!user.emailVerified) return { needsVerification: true };
  // Returns either { needsUsername: true } or { uid, username, refreshToken }.
  return identityRequest('/api/identity');
}

export async function chooseUsername(username) {
  return identityRequest('/api/identity', {
    method: 'POST', body: { username },
  });
}

export async function resetPassword(email) {
  await identityRequest('/api/identity/email', {
    method: 'POST', body: { kind: 'reset', email: email.trim().toLowerCase() },
    authenticated: false,
  });
  // Use a generic message regardless of whether the account exists.
  return 'If that email has an account, a reset link is on its way.';
}

export async function logout() {
  await supabase.removeAllChannels();
  await signOut(auth);
  // Also clear this app's cached records and selected account state.
}
```

Render the appropriate screen for `needsVerification` or `needsUsername`. After username registration succeeds, the helper refreshes the Firebase token when requested by the server. This makes the `role: authenticated` claim available to Supabase. Never set this claim from a client.

The username is shared, case insensitive, and currently permanent. It is an account name; sign-in still uses email/password. A username conflict returns HTTP 409. Keep an existing username when signing into another app.

Verification and password reset emails always use **Resend**, delivered from the central service. Do not call Firebase's `sendEmailVerification`, `sendPasswordResetEmail`, or REST `accounts:sendOobCode` in the new app. The server creates Firebase action links without asking Firebase to send an email. Links open the shared `/auth/action` page; users then return to their original app. After a password reset, sign in with the new password.

## 6. Protect the new app's data

For new tables, store the Firebase UID as **text**. Replace `YOUR_FIREBASE_PROJECT_ID` in this example and adapt the table to your app:

```sql
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid text NOT NULL DEFAULT (auth.jwt()->>'sub'),
  body text NOT NULL
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
CREATE POLICY own_notes ON public.notes FOR ALL TO authenticated
USING (
  owner_uid = (SELECT auth.jwt()->>'sub')
  AND (SELECT auth.jwt()->>'iss') = 'https://securetoken.google.com/YOUR_FIREBASE_PROJECT_ID'
  AND (SELECT auth.jwt()->>'aud') = 'YOUR_FIREBASE_PROJECT_ID'
  AND (SELECT auth.jwt()->>'email_verified') = 'true'
)
WITH CHECK (
  owner_uid = (SELECT auth.jwt()->>'sub')
  AND (SELECT auth.jwt()->>'iss') = 'https://securetoken.google.com/YOUR_FIREBASE_PROJECT_ID'
  AND (SELECT auth.jwt()->>'aud') = 'YOUR_FIREBASE_PROJECT_ID'
  AND (SELECT auth.jwt()->>'email_verified') = 'true'
);
```

`auth.uid()` expects a UUID; Firebase UIDs require `auth.jwt()->>'sub'`. Do not run Expensive's migration or call `/api/auth/bootstrap` for an unrelated app: those preserve Expensive's older UUID ownership. A fresh app using text Firebase UIDs does not need that mapping.

Create equally restrictive policies for every table, Storage bucket, and Realtime feature the app exposes. If you add private server endpoints, verify the Firebase ID token there before accessing data. Never accept a client-provided user ID as proof of identity.

## 7. Native iOS integration

With Firebase's Apple SDK, call the same identity endpoints using the user's ID token from `getIDToken`. After an identity response with `refreshToken: true`, use the SDK's forced token refresh before calling Supabase. Use its email/password signup, sign-in, user reload, and sign-out APIs; send verification/reset requests to the Resend identity endpoint above.

With the REST approach, follow [Expensive's API.swift](../ios/Expensive/API.swift) for Firebase sign-in/refresh and Keychain storage, and point the new app at its own Supabase URL/key. Replace Expensive's `completeAuthentication` bootstrap step with the new app's onboarding. Keep the Firebase string UID as the shared identity and supply refreshed Firebase tokens on data requests. Use a distinct Keychain service name for the new app.

## 8. Verify the integration

- A user registered in Expensive can sign in without creating a second account or username.
- A new user receives a Resend verification email and cannot read data before verification.
- A username already claimed in another app returns a conflict.
- Two users cannot read or modify each other's rows, including by guessed IDs.
- Password reset works across apps; logout clears the current app's cached data.
- Session refresh and reopening the browser/native app keep the correct identity.

Accounts are shared; sessions on unrelated website domains and separate native apps are separate. Automatic cross-domain SSO is not implemented. Disabling the Firebase user affects all apps, although already-issued ID tokens can remain usable at Supabase until they expire. Do not delete a shared identity as part of deleting only one app's data.

References: [Firebase with Supabase](https://supabase.com/docs/guides/auth/third-party/firebase-auth), [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth), [Firebase Apple setup](https://firebase.google.com/docs/ios/setup).
