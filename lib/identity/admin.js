import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { requireVerifiedUser } from './verified-user.mjs';

export function identityAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) throw new Error('Identity service is not configured.');
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId) throw new Error('Firebase project configuration does not match.');
  const app = getApps().find(app => app.name === 'identity') || initializeApp({
    credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }), projectId,
  }, 'identity');
  return { auth: getAuth(app), db: getFirestore(app) };
}
export async function verifiedIdentity(request, requireVerified = true) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 10000) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const { auth, db } = identityAdmin();
  let claims;
  // Verify signature/issuer/audience here; the single getUser below supplies
  // both revocation state and the current account for requireVerifiedUser.
  // verifyIdToken(token, true) would fetch that same user a second time.
  try { claims = await auth.verifyIdToken(token); }
  catch { throw Object.assign(new Error('Please sign in again.'), { status: 401 }); }
  const user = await auth.getUser(claims.uid);
  requireVerifiedUser(claims, user, requireVerified);
  return { auth, db, user, claims };
}
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  const allowed = (process.env.IDENTITY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && origin !== new URL(request.url).origin && !allowed.includes(origin)) throw Object.assign(new Error('Origin is not allowed.'), { status: 403 });
  return { 'Cache-Control': 'no-store', 'Vary': 'Origin', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
}
export function failure(error, headers = {}) {
  const status = error.status || 503;
  return Response.json({ error: status < 500 ? error.message : 'Account service is unavailable. Please try again shortly.' }, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}
