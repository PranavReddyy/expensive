"use client";
import { useEffect, useState } from "react";
import { createUserWithEmailAndPassword, reload, signOut } from "firebase/auth";
import { firebaseAuth, identityRequest, authMessage, sendAccountEmail, signInWithIdentifier, checkUsername } from "../lib/firebase-client";
import { useAuth } from "../lib/auth-context";

export default function LoginPage() {
  const { firebaseUser, needsUsername, error: accountError, refreshAuth, ready } = useAuth();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextEmail, setNextEmail] = useState(0);
  const verify = !!firebaseUser && !firebaseUser.emailVerified;
  const choosingUsername = needsUsername || (!firebaseUser && mode === 'signup');
  const [availability, setAvailability] = useState('');
  useEffect(() => {
    setAvailability('');
    if (!choosingUsername || !username.trim()) return;
    const controller = new AbortController();
    setAvailability('checking…');
    const timer = setTimeout(async () => {
      try {
        const available = await checkUsername(username.trim(), controller.signal);
        if (!controller.signal.aborted) setAvailability(available ? 'available' : 'already taken');
      } catch (error) { if (!controller.signal.aborted) setAvailability(error.message); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [username, choosingUsername]);

  async function run(action) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(authMessage(error)); }
    finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    await run(async () => {
      const auth = firebaseAuth();
      if (verify) {
        await reload(auth.currentUser); await auth.currentUser.getIdToken(true);
        if (!auth.currentUser.emailVerified) throw new Error("Open the verification link in your email first.");
        await refreshAuth();
      } else if (needsUsername) {
        await identityRequest("POST", username); await refreshAuth();
      } else if (firebaseUser) {
        await refreshAuth();
      } else if (mode === "reset") {
        await sendAccountEmail('reset', email.trim().toLowerCase());
        setNotice("If that email has an account, a password reset link is on its way.");
      } else if (mode === "signup") {
        if (password.length < 12) throw new Error("Use at least 12 characters for your password.");
        if (!await checkUsername(username.trim())) throw new Error('That username is already taken.');
        const { user } = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        setPassword("");
        await sendAccountEmail('verify'); setNextEmail(Date.now() + 60000);
        setNotice("Check your inbox for a verification link.");
      } else {
        await signInWithIdentifier(email.trim().toLowerCase(), password); setPassword("");
      }
    });
  }
  const label = verify ? "I've verified my email →" : needsUsername ? "save username →" : firebaseUser ? "retry connection →" : mode === "signup" ? "create account →" : mode === "reset" ? "send reset link →" : "sign in →";
  return <main style={s.page}><div style={s.box}>
    <p style={s.logo}>EXPENS***</p><p style={s.muted}>your money, at a glance</p>
    <form onSubmit={submit} style={s.form}>
      {verify ? <p style={s.muted}>Verify the link sent to {firebaseUser.email}, then continue here.</p>
        : needsUsername ? <p style={s.muted}>Confirm your username. It belongs to you across our apps.</p>
        : !firebaseUser && <>
          <label style={s.label}>{mode === 'signin' ? 'username or email' : 'email'}<input style={s.input} type={mode === 'signin' ? 'text' : 'email'} value={email} onChange={e => setEmail(e.target.value)} autoComplete={mode === 'signin' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} required /></label>
          {mode !== "reset" && <label style={s.label}>password<input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} required /></label>}
          {mode === "signup" && <p style={s.muted}>Already used Expensive with email codes? Create your password using that same email to keep your data.</p>}
        </>}
      {choosingUsername && <>
        <label style={s.label}>username<input style={s.input} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} pattern="[A-Za-z][A-Za-z0-9_]{2,23}" required aria-describedby="username-status" /></label>
        <p id="username-status" role="status" style={s.muted}>{availability || '3–24 letters, numbers, or underscores; start with a letter.'} {mode === 'signup' && !firebaseUser ? 'Your name is reserved when you confirm it after email verification.' : 'Usernames cannot currently be changed.'}</p>
      </>}
      {(error || accountError) && <p role="alert" style={s.muted}>{error || accountError}</p>}
      {notice && <p role="status" style={s.muted}>{notice}</p>}
      <button style={s.button} disabled={busy || !ready}>{busy || !ready ? "please wait…" : label}</button>
      {verify && <button type="button" style={s.link} disabled={busy} onClick={() => run(async () => {
        if (Date.now() < nextEmail) throw new Error("Wait a minute before requesting another email.");
        await sendAccountEmail('verify'); setNextEmail(Date.now() + 60000); setNotice("Verification link sent.");
      })}>resend verification email</button>}
      {firebaseUser ? <button type="button" style={s.link} disabled={busy} onClick={() => run(() => signOut(firebaseAuth()))}>use another account</button>
        : <div style={s.links}>
          <button type="button" style={s.link} disabled={busy} onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}>{mode === "signup" ? "sign in instead" : "create account"}</button>
          <button type="button" style={s.link} disabled={busy} onClick={() => { setMode(mode === "reset" ? "signin" : "reset"); setError(""); setNotice(""); }}>{mode === "reset" ? "back to sign in" : "forgot password?"}</button>
        </div>}
    </form>
  </div></main>;
}
const s = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  box: { width: "100%", maxWidth: 360 }, logo: { fontSize: 15, fontWeight: 600, letterSpacing: ".04em" },
  muted: { fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }, form: { display: "flex", flexDirection: "column", gap: 20, marginTop: 32 },
  label: { fontSize: 11, display: "flex", flexDirection: "column", gap: 6 },
  input: { padding: "10px 12px", border: "1px solid var(--border)", fontSize: 13, width: "100%" },
  button: { padding: "11px 16px", background: "#000", color: "#fff", border: 0, fontSize: 13, textAlign: "left" },
  link: { background: "transparent", border: 0, fontSize: 11, color: "var(--muted)", padding: "6px 0" },
  links: { display: "flex", justifyContent: "space-between", gap: 12 },
};
