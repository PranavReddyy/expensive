"use client";
import { useState } from 'react';
import { useQuery } from '../lib/useAppData';
import { supabase } from '../lib/supabase';
import { queryCache } from '../lib/query-cache.mjs';
import { fmt, fmtFullExpenseDate } from '../lib/format';
import Modal from './Modal';
export default function ActivityHistory({ profile, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const { data, pending, error: loadError } = useQuery(['activity',profile.id], ['account_activity'], async signal => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('account_activity').select('id,title,kind,amount,balance_delta,created_at,undone_at').eq('profile_id',profile.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999).abortSignal(signal);
      if (error) throw error;
      rows.push(...data); if (data.length < 1000) return rows;
    }
  });
  async function undo(id) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('undo_tab_payment',{p_id:id});
      if (error) throw error;
      queryCache.invalidate(['profiles','debts','expenses','account_activity']); setConfirmId(null);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="activity" busy={busy} onClose={onClose} style={{background:'var(--bg)',width:'100%',maxWidth:480,padding:20}}>
    <h2 style={{fontSize:14}}>activity · {profile.name}</h2>
    <p className="history-note">Payments and balance adjustments. Undo corrects your records, not a real-world transfer. Only payments recorded after the history update can be undone.</p>
    {(error || loadError) && <p role="alert">{error || loadError.message}<button type="button" onClick={() => queryCache.invalidate(['account_activity'])}>retry</button></p>}
    {pending && !data.length && <p>loading…</p>}
    {!pending && !loadError && !data.length && <p>No activity yet.</p>}
    {data.map(item => <section className="history-row" key={item.id}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><span>{item.title}</span><span>{fmt(item.amount)}</span></div>
      <p className="history-note">{item.kind === 'balance' ? 'balance adjustment' : Number(item.balance_delta)>0 ? 'payment received' : Number(item.balance_delta)<0 ? 'payment made' : 'matching amounts cleared'} · {fmtFullExpenseDate(item.created_at)}</p>
      {item.undone_at ? <small>undone</small> : item.kind === 'settlement' && (confirmId === item.id ? <div><p className="history-note">Restore the balance and tab amounts and remove any expense created by this payment?</p><button type="button" disabled={busy} onClick={() => setConfirmId(null)}>cancel</button> <button type="button" className="primary-action" disabled={busy} onClick={() => undo(item.id)}>{busy ? 'undoing…' : 'confirm undo'}</button></div> : <button type="button" disabled={busy} onClick={() => setConfirmId(item.id)}>undo payment</button>)}
    </section>)}
    <button type="button" className="primary-action" disabled={busy} onClick={onClose}>done</button>
  </Modal>;
}
