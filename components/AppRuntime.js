"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";
import { queryCache } from "../lib/query-cache.mjs";
import { useAuth } from "../lib/auth-context";

export default function AppRuntime() {
  const authenticatedPage = usePathname() !== "/";
  const { user, validating } = useAuth();
  useEffect(() => {
    if (!authenticatedPage || !user || validating) return;
    let connected = false;
    let interrupted = false;
    const channel = supabase.channel(`app-data:${user.id}`);
    for (const table of ["profiles", "categories", "expenses", "people", "debts", "account_activity"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table },
        () => queryCache.invalidate([table]));
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Catch changes missed between loading cached data and reconnecting.
        if (interrupted) queryCache.invalidate();
        connected = true;
        interrupted = false;
      } else if (connected || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        interrupted = true;
      }
    });
    const reconcile = () => queryCache.invalidate();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reconcile(); }, 120000);
    const visible = () => { if (document.visibilityState === "visible") reconcile(); };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", reconcile);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      supabase.removeChannel(channel);
    };
  }, [authenticatedPage, user?.id, validating]);
  return null;
}
