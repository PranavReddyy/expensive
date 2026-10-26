"use client";
import LoadingState from './LoadingState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { installAccount, authMessage } from '../lib/supabase-auth';
import { AuthContext } from '../lib/auth-context';
import { resetSession } from '../lib/useAppData';
import { queryCache } from '../lib/query-cache.mjs';

export default function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ user: null, authUser: null, ready: false, error: '', needsUsername: false });
  const owner = useRef(null);
  const generation = useRef(0);
  const pathname = usePathname(), router = useRouter();
  const accept = useCallback(session => {
    generation.current++;
    const raw = session?.user;
    if (owner.current !== (raw?.id || null)) {
      resetSession({ preservePreview: owner.current === null && !!raw });
      owner.current = raw?.id || null;
    }
    const authUser = installAccount(raw);
    const verified = !!raw?.email_confirmed_at;
    const username = raw?.app_metadata?.username;
    // Restored sessions enable local views/drafts. RLS authorizes every remote request.
    const user = verified && username ? { id: raw.id, email: raw.email, username, email_confirmed_at: raw.email_confirmed_at } : null;
    if (user) queryCache.setOwner(user.id);
    setAuth({ user, authUser, ready: true, error: '', needsUsername: verified && !username, validating: false });
  }, []);
  const refreshAuth = useCallback(async () => {
    const version = generation.current;
    const { data, error } = await supabase.auth.getSession();
    if (version !== generation.current) return;
    if (error) { setAuth(s => ({ ...s, ready: true, error: authMessage(error) })); return; }
    accept(data.session);
  }, [accept]);
  useEffect(() => {
    // A locally restored session is a display/draft hint, not server authorization.
    // Avoid waiting for an expired-token refresh to show a saved offline ledger.
    try {
      const saved = JSON.parse(localStorage.getItem('expensive.supabase.auth.v1') || 'null');
      if (saved?.access_token && saved?.refresh_token && saved.user?.id && saved.user?.email_confirmed_at) accept(saved);
    } catch {}
    // Do not await auth methods within the auth lock.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => accept(session));
    void refreshAuth();
    return () => data.subscription.unsubscribe();
  }, [accept, refreshAuth]);
  useEffect(() => {
    if (!auth.ready || pathname === '/auth/action') return;
    if (!auth.user && pathname !== '/') router.replace('/');
    if (auth.user && pathname === '/') router.replace('/dashboard');
  }, [auth.ready, auth.user, pathname, router]);
  return <AuthContext.Provider value={{ ...auth, refreshAuth }}>
    {pathname === '/' || pathname === '/auth/action' || (auth.ready && auth.user)
      ? <div key={auth.user?.id || 'signed-out'}>{children}</div>
      : <div style={{ padding: 24 }}><LoadingState label="opening your account" /></div>}
  </AuthContext.Provider>;
}
