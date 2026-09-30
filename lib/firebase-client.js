"use client";
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';

export function firebaseAuth() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) throw new Error('Sign-in is not configured yet.');
  return getAuth(getApps().length ? getApp() : initializeApp({ apiKey, projectId,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID }));
}
export async function identityRequest(method = 'GET', username) {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Please sign in again.');
  const response = await fetch(`${process.env.NEXT_PUBLIC_IDENTITY_URL || ''}/api/identity`, {
    method, headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ username }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load your account.');
  if (data.refreshToken) await user.getIdToken(true);
  return data;
}
export function authMessage(error) {
  const code = error?.code || '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) return 'Email or password is incorrect.';
  if (code === 'auth/email-already-in-use') return 'An account already uses that email. Sign in or reset your password.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Choose a stronger password (at least 12 characters).';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/network-request-failed') return 'Check your connection and try again.';
  return code ? 'Could not sign in. Please try again.' : error?.message || 'Please try again.';
}

export async function signInWithIdentifier(identifier, password) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_IDENTITY_URL || ''}/api/identity/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not sign in.');
  return signInWithCustomToken(firebaseAuth(), data.customToken);
}

export async function checkUsername(username, signal) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_IDENTITY_URL || ''}/api/identity/username?username=${encodeURIComponent(username)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not check username.');
  return data.available;
}

export async function sendAccountEmail(kind, email) {
  const auth = firebaseAuth();
  const response = await fetch(`${process.env.NEXT_PUBLIC_IDENTITY_URL || ''}/api/identity/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(kind === 'verify' && auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
    body: JSON.stringify({ kind, email }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not send email.');
  if (data.sent !== true) throw new Error('Email delivery is unavailable. Please try again shortly.');
}
