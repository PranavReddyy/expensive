"use client";
import { amountValue, validAmount } from '../lib/amount.mjs';
import AmountInput from './AmountInput';
import { useRef,useState } from 'react';
import { useProfiles,useCategories,useQuery } from '../lib/useAppData';
import { supabase } from '../lib/supabase';
import { queryCache } from '../lib/query-cache.mjs';
import { fmt } from '../lib/format';
import { localDateTime } from './ExpenseEditor';
import CategoryChips from './CategoryChips';

export default function RecurringExpenses() {
  const {profiles,activeId}=useProfiles(),categories=useCategories();
  const {data:rules,error:loadError}=useQuery(['recurring'],['recurring_expenses'],async signal=>{
    const rows=[];
    for(let offset=0;;offset+=1000) {
      const {data,error}=await supabase.from('recurring_expenses').select('*').order('next_due').order('id').range(offset,offset+999).abortSignal(signal);
      if(error) throw error; rows.push(...data); if(data.length<1000) return rows;
    }
  });
  const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [profile,setProfile]=useState(''),[reason,setReason]=useState(''),[amount,setAmount]=useState('');
  const [notes,setNotes]=useState('');
  const [category,setCategory]=useState(null),[cadence,setCadence]=useState('monthly'),[start,setStart]=useState(localDateTime().slice(0,10));
  const request=useRef(null);
  const today=localDateTime().slice(0,10);
  async function run(name,payload) {
    if(busy) return false;
    setBusy(true);setError('');
    try {const {error}=await supabase.rpc(name,payload);if(error) throw error;queryCache.invalidate(['recurring_expenses','expenses','profiles']);return true;}
    catch(e){setError(e.message);return false;} finally{setBusy(false);}
  }
  async function add() {
    if(!reason.trim() || !validAmount(amount) || amountValue(amount)<=0 || !start){setError('Enter a reason, positive amount and first date.');return;}
    const payload={p_profile:profile || activeId,p_reason:reason.trim(),p_amount:amountValue(amount),p_category:category,p_notes:notes.trim(),p_cadence:cadence,p_start:start};
    const key=JSON.stringify(payload);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    if(await run('add_recurring_expense',{...payload,p_id:request.current.id})){setAdding(false);setReason('');setAmount('');request.current=null;}
  }
  return <section className="data-tools">
    <h3>recurring expenses</h3><p className="muted">Review each occurrence before recording. Schedules never deduct money automatically.</p>
    {(error || loadError) && <p role="alert">{error || loadError.message}</p>}
    {rules.map(rule=><div className="tool-row" key={rule.id}>
      <div><strong>{rule.reason} · {fmt(rule.amount)}</strong><p className="muted">{profiles.find(p=>p.id===rule.profile_id)?.name} · {rule.cadence} · {rule.paused?'paused':`due ${rule.next_due}`}</p></div>
      <div className="tool-actions">
        {!rule.paused && rule.next_due<=today && <><button type="button" className="primary-action" disabled={busy} onClick={()=>run('review_recurring_expense',{p_id:rule.id,p_due:rule.next_due,p_action:'record',p_date:new Date(`${rule.next_due}T12:00:00`).toISOString()})}>record</button>
          <button type="button" disabled={busy} onClick={()=>run('review_recurring_expense',{p_id:rule.id,p_due:rule.next_due,p_action:'skip',p_date:new Date(`${rule.next_due}T12:00:00`).toISOString()})}>skip</button></>}
        <button type="button" disabled={busy} onClick={()=>run('pause_recurring_expense',{p_id:rule.id,p_paused:!rule.paused})}>{rule.paused?'resume':'pause'}</button>
      </div>
    </div>)}
    {!rules.length && !loadError && <p className="muted">No schedules yet.</p>}
    {adding ? <fieldset disabled={busy} className="expense-fields">
      <label>profile<select value={profile || activeId || ''} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label>amount<AmountInput inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <CategoryChips categories={categories} value={category} onChange={setCategory}/>
      <label>notes<input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      <label>repeat<select value={cadence} onChange={e=>setCadence(e.target.value)}>{['weekly','monthly','yearly'].map(c=><option key={c}>{c}</option>)}</select></label>
      <label>first due date<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <div className="tool-actions"><button type="button" onClick={()=>setAdding(false)}>cancel</button><button type="button" className="primary-action" onClick={add}>save schedule</button></div>
    </fieldset> : <button type="button" disabled={busy || !profiles.length} onClick={()=>setAdding(true)}>add schedule</button>}
  </section>;
}
