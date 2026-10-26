"use client";
import { supabase } from './supabase';
let current = null;
export function currentAccount() { return current; }
export function installAccount(user) {
  current = user ? {
    uid: user.id, email: user.email, emailVerified: !!user.email_confirmed_at,
    username: user.app_metadata?.username,
    async getIdToken() {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session || data.session.user.id !== user.id || current?.uid !== user.id) throw new Error('Sign in again to sync this account.');
      return data.session.access_token;
    },
  } : null;
  return current;
}
export const authMessage = error => error?.message || 'Please try again.';
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
  installAccount(null);
}
export async function signInWithIdentifier(identifier, password) {
  if (identifier.includes('@')) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: identifier, password });
    if (error) throw error;
    return data;
  }
  const response = await fetch('/api/identity/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not sign in.');
  const result = await supabase.auth.setSession(data);
  if (result.error) throw result.error;
  return result.data;
}
export async function identityRequest(method = 'GET', username) {
  if (method === 'POST') {
    const { error } = await supabase.rpc('claim_username', { p_username: username.trim().toLowerCase() });
    if (error) throw error;
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return { username: data.user?.app_metadata?.username, needsUsername: !data.user?.app_metadata?.username };
}
export async function checkUsername(username, signal) {
  let query = supabase.rpc('username_available', { p_username: username.trim().toLowerCase() });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export async function sendAccountEmail(kind, email) {
  const redirectTo = `${window.location.origin}/auth/action`;
  const result = kind === 'reset'
    ? await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    : await supabase.auth.resend({ type: 'signup', email: email || current?.email, options: { emailRedirectTo: redirectTo } });
  if (result.error) throw result.error;
}
