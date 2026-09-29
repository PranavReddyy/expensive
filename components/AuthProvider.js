"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { AuthContext } from "../lib/auth-context";
import { resetSession } from "../lib/useAppData";

export default function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ user: null, ready: false });
  const identity = useRef(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user?.email_confirmed_at ? session.user : null;
      if (identity.current !== (user?.id || null)) {
        resetSession();
        identity.current = user?.id || null;
      }
      setAuth({ user, ready: true });
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // A browser back/forward snapshot may predate logout or an account switch.
    const restore = event => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  useEffect(() => {
    if (auth.ready && !auth.user && pathname !== "/") {
      router.replace("/");
      router.refresh();
    }
  }, [auth.ready, auth.user, pathname, router]);

  return <AuthContext.Provider value={auth}>
    {pathname === "/" || (auth.ready && auth.user)
      ? <div key={auth.user?.id || "signed-out"}>{children}</div>
      : <div style={{ padding: 24, fontSize: 11, color: "var(--muted)" }}>loading…</div>}
  </AuthContext.Provider>;
}
