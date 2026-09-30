import { createHash } from 'node:crypto';
import { normalizeUsername } from './username.mjs';

export const invalidLogin = () => Object.assign(new Error('Username, email, or password is incorrect.'), { status: 401 });

// Only trust Vercel's overwritten forwarding header, never a caller's arbitrary IP.
export async function limitPublicAuth(db, request, scope, maximum = 30) {
  const address = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || 'unknown' : 'local';
  const key = createHash('sha256').update(`${scope}:${address}`).digest('hex');
  const ref = db.collection('authLimits').doc(key);
  await db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data();
    const now = Date.now();
    const count = old?.start > now - 60000 ? old.count : 0;
    if (count >= maximum) throw Object.assign(new Error('Too many attempts. Please wait a minute.'), { status: 429 });
    tx.set(ref, { start: count ? old.start : now, count: count + 1, expiresAt: new Date(now + 86400000) });
  });
}

export async function passwordLogin({ auth, db, apiKey, identifier, password, fetcher = fetch }) {
  if (typeof identifier !== 'string' || typeof password !== 'string' || !password || password.length > 4096 || identifier.length > 254) throw invalidLogin();
  let email = identifier.trim().toLowerCase();
  if (!email.includes('@')) {
    let username;
    try { username = normalizeUsername(email); } catch { throw invalidLogin(); }
    const reservation = await db.collection('usernames').doc(username).get();
    // Do not expose the email or mint a session until Firebase checks the password.
    if (!reservation.exists) throw invalidLogin();
    let user;
    try { user = await auth.getUser(reservation.data().uid); }
    catch (error) { if (error.code === 'auth/user-not-found') throw invalidLogin(); throw error; }
    if (user.disabled || !user.email) throw invalidLogin();
    email = user.email;
  }
  if (!apiKey) throw new Error('Firebase API key missing');
  const response = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data.error?.message;
    if (response.status === 429 || code === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw Object.assign(new Error('Too many attempts. Please try again later.'), { status: 429 });
    if (['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'USER_DISABLED', 'INVALID_EMAIL'].includes(code)) throw invalidLogin();
    throw new Error('Password sign-in service unavailable');
  }
  // Never bypass a second-factor challenge if MFA is enabled in the future.
  if (!data.idToken || !data.refreshToken || !data.localId || data.mfaPendingCredential) throw invalidLogin();
  return { customToken: await auth.createCustomToken(data.localId) };
}
