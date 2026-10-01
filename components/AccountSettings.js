"use client";
import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { usePreferences } from './Preferences';
import { currencySymbols } from '../lib/format';
import Modal from './Modal';
import LogoutButton from './LogoutButton';
export default function AccountSettings() {
  const { user } = useAuth();
  const { currency, appearance, update } = usePreferences();
  const [open, setOpen] = useState(false);
  return <>
    <button className="account-viewer" onClick={() => setOpen(true)} aria-label="Your account settings">{user?.username ? `@${user.username}` : 'account'}</button>
    {open && <Modal title="your account" onClose={() => setOpen(false)} style={{ background:'var(--bg)', width:'100%', maxWidth:480, padding:20 }}>
      <h2 style={{fontSize:14,marginBottom:18}}>your account</h2>
      <p className="account-detail">{user?.username ? `@${user.username}` : ''}</p>
      <p className="account-detail">{user?.email}</p>
      <fieldset className="settings-field"><legend>appearance</legend><div className="segmented">
        {['system','light','dark'].map(mode => <button type="button" key={mode} aria-pressed={appearance === mode} onClick={() => update({appearance:mode})}>{mode}</button>)}
      </div></fieldset>
      <label className="settings-field">currency <select value={currency} onChange={e => update({currency:e.target.value})}>{Object.entries(currencySymbols).map(([code,symbol]) => <option key={code} value={code}>{code} · {symbol}</option>)}</select></label>
      <p style={{fontSize:11,color:'var(--muted)'}}>Display symbol only. Existing amounts are not converted. Preferences stay on this device.</p>
      <div className="settings-actions"><LogoutButton /><button type="button" className="primary-action" onClick={() => setOpen(false)}>done</button></div>
    </Modal>}
  </>;
}
