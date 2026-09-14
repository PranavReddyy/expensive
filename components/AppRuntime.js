"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";
import { queryCache } from "../lib/query-cache.mjs";

export default function AppRuntime() {
  const authenticatedPage = usePathname() !== "/";
  useEffect(() => {
    if (!authenticatedPage) return;
    let connected = false;
    let interrupted = false;
    const channel = supabase.channel("app-data");
    for (const table of ["profiles", "categories", "expenses", "people", "debts"]) {
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
    const visible = () => { if (document.visibilityState === "visible") reconcile(); };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", visible);
      supabase.removeChannel(channel);
    };
  }, [authenticatedPage]);
  return null;
}
