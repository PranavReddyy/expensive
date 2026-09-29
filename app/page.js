"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";

function authError(error) {
  if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(error?.code) || error?.status === 429)
    return "Too many attempts. Please wait a minute before trying again.";
  if (["otp_expired", "otp_disabled", "invalid_credentials"].includes(error?.code))
    return "That code is invalid or expired. Try again or request a new code.";
  return "Could not sign in. Please try again in a moment.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginPending = useRef(false);

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);

  async function sendCode() {
    if (loginPending.current || (sent && Date.now() < retryAt)) return;
    loginPending.current = true;
    setLoading(true); setError(""); setNotice("");
    try {
      const normalized = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true } });
      if (error) throw error;
      setEmail(normalized); setSent(true); setCode(""); setRetryAt(Date.now() + 60000);
      setNotice("Code sent. Check your inbox and spam folder.");
    } catch (error) { setError(authError(error)); }
    finally { loginPending.current = false; setLoading(false); }
  }

  async function verifyCode(e) {
    e.preventDefault();
    if (loginPending.current) return;
    loginPending.current = true;
    setLoading(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      if (error) throw error;
      if (!data.session || !data.user?.email_confirmed_at) throw new Error("No verified session");
      // Start a fresh page after cookies have been saved, including a fresh data cache.
      window.location.replace("/dashboard");
    } catch (error) {
      setError(authError(error));
    } finally {
      loginPending.current = false;
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.box}>
        <p style={s.logo}>EXPENS***</p>
        <p style={s.version}>your money, at a glance</p>

        <form onSubmit={sent ? verifyCode : e => { e.preventDefault(); sendCode(); }} style={s.form}>
          <div style={s.field}>
            <label htmlFor="email" style={s.label}>email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={s.input}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading || sent}
              required
            />
          </div>

          {sent ? <div style={s.field}>
            <label htmlFor="code" style={s.label}>verification code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6,10}"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              style={s.input}
              autoComplete="one-time-code"
              autoFocus
              disabled={loading}
              required
            />
          </div> : <p style={s.label}>We'll email you a code to sign in or create your account. No password needed.</p>}

          {notice && <p role="status" style={s.label}>{notice}</p>}
          {error && <p role="alert" style={s.error}>{error}</p>}

          <button type="submit" style={s.btn} disabled={loading}>
            {loading ? "please wait…" : sent ? "verify & continue →" : "send code →"}
          </button>
          {sent && <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <button type="button" style={s.link} disabled={loading || seconds > 0} onClick={sendCode}>
              {seconds > 0 ? `resend in ${seconds}s` : "resend code"}
            </button>
            <button type="button" style={s.link} disabled={loading} onClick={() => { setSent(false); setCode(""); setError(""); setNotice(""); }}>change email</button>
          </div>}
        </form>
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  box: {
    width: "100%",
    maxWidth: "360px",
  },
  logo: {
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    marginBottom: "4px",
  },
  version: {
    fontSize: "11px",
    color: "var(--muted)",
    marginBottom: "40px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "11px",
    color: "var(--muted)",
    textTransform: "lowercase",
  },
  input: {
    padding: "10px 12px",
    border: "1px solid var(--border)",
    fontSize: "13px",
    width: "100%",
    outline: "none",
  },
  error: {
    fontSize: "11px",
    color: "var(--text)",
    background: "var(--subtle)",
    padding: "8px 12px",
    borderLeft: "2px solid #000",
  },
  btn: {
    padding: "11px 16px",
    background: "#000",
    color: "#fff",
    border: "none",
    fontSize: "13px",
    textAlign: "left",
    letterSpacing: "0.02em",
  },
  link: { background: "transparent", border: 0, fontSize: 11, color: "var(--muted)", padding: "6px 0" },
};
