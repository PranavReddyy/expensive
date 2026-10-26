"use client";
import { amountValue, validAmount } from '../lib/amount.mjs';
import AmountInput from './AmountInput';
import { useRef, useState } from 'react';
import Modal from './Modal';
import CategoryChips from './CategoryChips';
import { supabase } from '../lib/supabase';
import { queryCache } from '../lib/query-cache.mjs';

export function localDateTime(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export default function ExpenseEditor({ expense, categories, onClose }) {
  const [reason,setReason]=useState(expense.reason);
  const [amount,setAmount]=useState(String(expense.amount));
  const [notes,setNotes]=useState(expense.notes || '');
  const [category,setCategory]=useState(expense.category_id);
  const [date,setDate]=useState(localDateTime(expense.created_at));
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const request=useRef(null);
  async function save() {
    if (!validAmount(amount) || amountValue(amount)<=0 || !reason.trim() || !date) { setError('Enter a reason, amount and date.');return; }
    const payload={p_id:expense.id,p_version:expense.version ?? 1,p_reason:reason.trim(),p_amount:amountValue(amount),p_notes:notes,p_created_at:new Date(date).toISOString(),p_category:category || null};
    const key=JSON.stringify(payload);
    if(request.current?.key!==key) request.current={key,id:crypto.randomUUID()};
    setBusy(true);setError('');
    try {
      const {error}=await supabase.rpc('edit_expense',{...payload,p_request:request.current.id});
      if(error) throw error;
      queryCache.invalidate(['profiles','expenses']);onClose();
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <Modal title="edit expense" onClose={onClose} onSubmit={save} busy={busy} style={{background:'var(--bg)',padding:20,width:'100%',maxWidth:480}}>
    <h2>edit expense</h2>
    <fieldset disabled={busy} className="expense-fields">
      <label>reason<input value={reason} onChange={e=>setReason(e.target.value)} required /></label>
      <label>amount<AmountInput inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required /></label>
      <CategoryChips categories={categories} value={category} onChange={setCategory}/>
      <label>date<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} required /></label>
      <label>notes<input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="settings-actions"><button type="button" disabled={busy} onClick={onClose}>cancel</button><button className="primary-action" disabled={busy} type="submit">{busy?'saving…':'save'}</button></div>
  </Modal>;
}
