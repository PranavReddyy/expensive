"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, onIdTokenChanged } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { firebaseAuth, identityRequest, authMessage } from "../lib/firebase-client";
import { supabase } from "../lib/supabase";
import { AuthContext } from "../lib/auth-context";
import { resetSession } from "../lib/useAppData";
import { queryCache } from "../lib/query-cache.mjs";
import { readPreview, savePreview } from '../lib/startup-preview.mjs';

export default function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ user: null, firebaseUser: null, ready: false, error: "", needsUsername: false });
  const generation = useRef(0);
  const identity = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const refreshAuth = useCallback(async () => {
    const version = ++generation.current;
    let firebaseUser;
    try {
      firebaseUser = firebaseAuth().currentUser;
      if (identity.current !== (firebaseUser?.uid || null)) {
        resetSession({ preservePreview: identity.current === null && !!firebaseUser }); identity.current = firebaseUser?.uid || null;
      }
      setAuth({ user: null, firebaseUser, ready: false, error: "", needsUsername: false });
      if (!firebaseUser?.emailVerified) {
        resetSession();
        if (version === generation.current) setAuth({ user: null, firebaseUser, ready: true, error: "", needsUsername: false });
        return;
      }
      let cached;
      try { cached = readPreview(window.sessionStorage,firebaseUser); } catch {}
      if (cached) {
        queryCache.setOwner(cached.id);
        const ledger = queryCache.entry(JSON.stringify([cached.id,'ledger-v1'])).snapshot.data;
        if (ledger?.profiles && ledger?.debts && ledger?.people) {
          setAuth({user:cached,firebaseUser,ready:true,validating:true,error:'',needsUsername:false});
        }
      }
      // Established users already carry the role set by username enrollment.
      // Bootstrap still validates revocation, verification and ownership.
      const tokenResult = await firebaseUser.getIdTokenResult();
      const profile = tokenResult.claims.role === "authenticated" ? {} : await identityRequest();
      if (version !== generation.current) return;
      if (profile.needsUsername) {
        resetSession();
        setAuth({ user: null, firebaseUser, ready: true, needsUsername: true, error: "" }); return;
      }
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/auth/bootstrap", { method: "POST", headers: { Authorization: "Bearer " + token } });
      const user = await response.json();
      if (!response.ok) throw new Error(user.error);
      if (version !== generation.current || firebaseAuth().currentUser?.uid !== firebaseUser.uid) return;
      queryCache.setOwner(user.id);
      try { savePreview(window.sessionStorage,firebaseUser,user); } catch {}
      setAuth({ user, firebaseUser, ready: true, error: "", needsUsername: false });
      // Realtime setup is not required to render or read via authenticated REST.
      void supabase.realtime.setAuth(token).catch(() => {});
    } catch (error) {
      if (version === generation.current) {
        resetSession();
        setAuth({ user: null, firebaseUser, ready: true, error: authMessage(error), needsUsername: false });
      }
    }
  }, []);

  useEffect(() => {
    let unsubscribe = () => {}, tokenUnsubscribe = () => {};
    try {
      const client = firebaseAuth();
      unsubscribe = onAuthStateChanged(client, () => { void refreshAuth(); });
      tokenUnsubscribe = onIdTokenChanged(client, async user => {
        if (user?.emailVerified) {
          try { await supabase.realtime.setAuth(await user.getIdToken()); } catch {}
        } else { void supabase.removeAllChannels(); }
      });
    } catch (error) { setAuth({ user: null, ready: true, error: authMessage(error) }); }
    const restore = event => { if (event.persisted) void refreshAuth(); };
    window.addEventListener("pageshow", restore);
    return () => { generation.current++; unsubscribe(); tokenUnsubscribe(); window.removeEventListener("pageshow", restore); };
  }, [refreshAuth]);

  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.user && pathname !== "/" && pathname !== "/auth/action") router.replace("/");
    if (auth.user && pathname === "/") router.replace("/dashboard");
  }, [auth.ready, auth.user, pathname, router]);

  return <AuthContext.Provider value={{ ...auth, refreshAuth }}>
    {pathname === "/" || pathname === "/auth/action" || (auth.ready && auth.user)
      ? <>{auth.validating && <div role="status" className="startup-status">saved data · verifying account…</div>}<div key={auth.user?.id || "signed-out"} inert={auth.validating ? true : undefined}>{children}</div></>
      : <div style={{ padding: 24, fontSize: 11 }}>loading…</div>}
  </AuthContext.Provider>;
}
