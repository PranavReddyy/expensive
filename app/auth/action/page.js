"use client";
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
export default function EmailActionPage() {
  const [state, setState] = useState({ message: 'Checking your link…', recovery: false });
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(null);
  useEffect(() => {
    let active = true;
    pending.current ??= (async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const type = url.searchParams.get('type') || hash.get('type');
      const tokenHash = url.searchParams.get('token_hash');
      let result;
      if (tokenHash && ['recovery','signup','email'].includes(type)) {
        result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      } else if (url.searchParams.get('code')) {
        result = await supabase.auth.exchangeCodeForSession(url.searchParams.get('code'));
      } else if (hash.get('access_token') && ['recovery','signup','email'].includes(type)) {
        result = await supabase.auth.getSession();
      } else {
        throw new Error('This link is invalid or expired. Request a new email.');
      }
      window.history.replaceState(window.history.state, '', '/auth/action');
      if (result.error || !result.data?.session) throw new Error('This link is invalid or expired. Request a new email.');
      return { recovery: type === 'recovery', message: type === 'recovery' ? 'Choose your new Expensive password.' : 'Email verified. Return to the app and sign in.' };
    })();
    pending.current.then(s => { if (active) setState(s); }).catch(e => { if (active) setState({ message: e.message }); });
    return () => { active = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(''); setState({ message: 'Password updated. Sign in with it on your iPhone or the web.' });
    } catch (e) { setState(s => ({ ...s, message: e.message })); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 400, margin: '15vh auto', padding: 24, fontSize: 13 }}>
    <h1 style={{ fontSize: 18 }}>EXPENS***</h1><p role="status" style={{ margin: '24px 0', lineHeight: 1.7 }}>{state.message}</p>
    {state.recovery && <form onSubmit={save} style={{ display:'grid', gap:16 }}>
      <label>new password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} style={{display:'block',padding:12,width:'100%'}} /></label>
      <button disabled={busy} style={{padding:12,background:'var(--text)',color:'var(--bg)'}}>{busy ? 'saving…' : 'save password'}</button>
    </form>}
    <a href="/" style={{display:'inline-block',marginTop:24}}>back to sign in →</a>
  </main>;
}
