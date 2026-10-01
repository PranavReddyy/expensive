"use client";
import { useEffect, useRef, useState } from 'react';
import { applyActionCode, verifyPasswordResetCode, confirmPasswordReset, reload } from 'firebase/auth';
import { firebaseAuth, authMessage } from '../../../lib/firebase-client';
import { readEmailAction } from '../../../lib/identity/account-email.mjs';

export default function EmailActionPage() {
  const [state, setState] = useState({ mode: '', code: '', message: 'Checking your link…' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  useEffect(() => {
    let active = true;
    const { mode, code } = readEmailAction(window.location.href);
    window.history.replaceState(window.history.state, '', window.location.pathname);
    // Strict Mode can re-run effects. Consume each one-time email code once.
    pending.current ??= (async () => {
      if (!code) throw new Error('Incomplete link');
      const auth = firebaseAuth();
      if (mode === 'verifyEmail') {
        await applyActionCode(auth, code);
        if (auth.currentUser) { await reload(auth.currentUser); await auth.currentUser.getIdToken(true); }
        return { message: 'Email verified. Return to the app to continue.' };
      }
      if (mode === 'resetPassword') {
        await verifyPasswordResetCode(auth, code);
        return { mode, code, message: 'Choose a new password for your shared account.' };
      }
      throw new Error('Unsupported link');
    })();
    pending.current.then(result => { if (active) setState(result); })
      .catch(() => { if (active) setState({ message: 'This link is invalid or expired. Request a new email from the app.' }); });
    return () => { active = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      await confirmPasswordReset(firebaseAuth(), state.code, password);
      setPassword(''); setState({ message: 'Password updated. You can now sign in on any of our apps.' });
    } catch (error) { setState(s => ({ ...s, message: authMessage(error) })); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 400, margin: '15vh auto', padding: 24, fontSize: 13 }}>
    <h1 style={{ fontSize: 18 }}>EXPENS***</h1><p role="status" style={{ margin: '24px 0', lineHeight: 1.7 }}>{state.message}</p>
    {state.mode === 'resetPassword' && <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
      <label>new password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} style={{ display: 'block', padding: 12, border: '1px solid #ccc', width: '100%' }} /></label>
      <button disabled={busy} style={{ padding: 12, background: 'var(--text)', color: 'var(--bg)' }}>{busy ? 'saving…' : 'save password'}</button>
    </form>}
    <a href="/" style={{ display: 'inline-block', marginTop: 24 }}>back to sign in →</a>
  </main>;
}
