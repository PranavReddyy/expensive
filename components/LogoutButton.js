"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resetSession } from "../lib/useAppData";

export default function LogoutButton({ style }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      resetSession();
      router.replace("/");
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <button type="button" style={style} onClick={logout} disabled={busy}
    aria-label={error ? "Exit failed, retry logout" : "Log out"}>
    {busy ? "exiting..." : error ? "retry exit" : "EXIT"}
  </button>;
}
