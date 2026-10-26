"use client";
import { amountValue, validAmount } from '../../lib/amount.mjs';
import AmountInput from '../../components/AmountInput';
import {useState,useRef,useEffect} from 'react';
import Link from 'next/link';
import Nav from '../../components/Nav';
import LoadingState from '../../components/LoadingState';
import AccountSwitcher from '../../components/AccountSwitcher';
import CategoryChips from '../../components/CategoryChips';
import Modal from '../../components/Modal';
import {useProfiles,usePeople,useCategories,useQuery,useDebts} from '../../lib/useAppData';
import {supabase} from '../../lib/supabase';
import {queryCache} from '../../lib/query-cache.mjs';
import {fmt} from '../../lib/format';
import {usePreferences} from '../../components/Preferences';
import {splitTripAmount,equalTripShares} from '../../lib/trips.mjs';

// Ledger snapshots and retry receipts are server-only details: a bill's display
// query should not download copies of every linked expense and debt.
const columns={trips:'id,profile_id,name,budget,personal_budget,starts_on,ends_on,completed,created_at',trip_members:'person_id',trip_entries:'id,trip_id,reason,amount,payer,shares,category_id,created_at,version'};
async function all(table,filter,signal){let rows=[];for(let offset=0;;offset+=1000){let q=supabase.from(table).select(columns[table]).order(table==='trip_members'?'person_id':'id').range(offset,offset+999).abortSignal(signal);if(filter)q=q.eq(...filter);const {data,error}=await q;if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}}
const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export default function Trips(){
 usePreferences();const {profiles,activeId,switchProfile,loading:ledgerLoading,dataError}=useProfiles();const savedPeople=usePeople(activeId),categories=useCategories(),debts=useDebts(activeId);
 const [addedPeople,setAddedPeople]=useState([]);
 const people=[...savedPeople,...addedPeople.filter(p=>p.profile_id===activeId&&!savedPeople.some(saved=>saved.id===p.id))];
 const trips=useQuery(['trips',activeId],['trips'],signal=>all('trips',['profile_id',activeId],signal),!!activeId);
 const [selected,setSelected]=useState(null),[modal,setModal]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setSelected(new URLSearchParams(window.location.search).get('trip'));},[]);
 const [deleting,setDeleting]=useState(null);
 const [search,setSearch]=useState('');const request=useRef(null),operation=useRef(false);
 const trip=trips.data.find(t=>t.id===selected);
 const members=useQuery(['trip-members',trip?.id],['trip_members'],s=>all('trip_members',['trip_id',trip.id],s),!!trip);
 const entries=useQuery(['trip-entries',trip?.id],['trip_entries'],s=>all('trip_entries',['trip_id',trip.id],s),!!trip);
 const [form,setForm]=useState({});const [expense,setExpense]=useState({});
 const names=[{id:'me',name:'you'},...people.filter(p=>members.data.some(m=>m.person_id===p.id))];
 const total=entries.data.reduce((sum,e)=>sum+Number(e.amount),0),own=entries.data.reduce((sum,e)=>sum+Number(e.shares.me||0),0);
 const outstanding=debts.filter(d=>d.trip_id===trip?.id);
 function openTrip(edit=false){request.current=edit?trip.id:crypto.randomUUID();setForm(edit?{editing:true,name:trip.name,budget:String(trip.budget),personalBudget:String(trip.personal_budget||0),start:trip.starts_on,end:trip.ends_on,people:members.data.map(m=>m.person_id)}:{name:'',budget:'',personalBudget:'',start:localDay(),end:localDay(),people:[]});setSearch('');setError('');setModal('trip');}
 function openExpense(entry=null){request.current=crypto.randomUUID();setExpense(entry?{id:entry.id,version:entry.version,reason:entry.reason,amount:String(entry.amount),payer:entry.payer||'me',selected:Object.keys(entry.shares),original:entry,custom:!equalTripShares(entry.amount,entry.shares),shares:Object.fromEntries(Object.entries(entry.shares).map(([id,n])=>[id,String(n)])),category:entry.category_id||''}:{reason:'',amount:'',payer:'me',selected:names.map(n=>n.id),custom:false,shares:{},category:''});setError('');setModal('expense');}
 async function action(work,tables=['trips','trip_members','trip_entries','profiles','people','debts','expenses']){
  if(operation.current)return;
  if(typeof navigator!=='undefined'&&!navigator.onLine){setError('You’re offline. Reconnect and save again; your entries are still here.');return;}
  operation.current=true;setBusy(true);setError('');
  try{await work();queryCache.invalidate(tables);setModal(null)}
  catch(e){setError(e.message||'Could not save. Your entries are still here; please retry.');}
  finally{operation.current=false;setBusy(false)}
 }
 async function rpc(name,payload){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const {error}=await supabase.rpc(name,payload).abortSignal(controller.signal);
   if(controller.signal.aborted)throw new Error('The connection timed out. Keep this form open and retry to confirm the save.');
   if(error)throw error;
  }finally{clearTimeout(timer);}
 }
 async function addPerson(){
  if(operation.current)return;operation.current=true;setBusy(true);setError('');
  const name=search.trim(),profile=activeId;
  try{
   const person={id:crypto.randomUUID(),profile_id:profile,name};
   const {error}=await supabase.from('people').insert(person);if(error)throw error;
   setAddedPeople(rows=>[...rows,person]);setForm(current=>({...current,people:[...current.people,person.id]}));setSearch('');queryCache.invalidate(['people']);
  }catch(e){setError(e.message||'Could not add this person. Please retry.');}
  finally{operation.current=false;setBusy(false);}
 }
 function saveTrip(){return action(async()=>{
  const budget=amountValue(form.budget||0),personal=amountValue(form.personalBudget||0);
  if(!form.name.trim()||!validAmount(form.budget||0)||!validAmount(form.personalBudget||0)||!form.start||!form.end||form.end<form.start)throw new Error('Enter a trip name, valid budgets and an end date on or after the start.');
  await rpc('save_trip_budgets',{p_id:request.current,p_profile:activeId,p_name:form.name.trim(),p_budget:budget,p_personal_budget:personal,p_start:form.start,p_end:form.end,p_people:form.people});setSelected(request.current)
 },['trips','trip_members'])}
 function currentShares(){const original=expense.original;if(!expense.custom&&original&&equalTripShares(original.amount,original.shares)&&amountValue(expense.amount)===Number(original.amount)&&expense.selected.length===Object.keys(original.shares).length&&expense.selected.every(id=>id in original.shares))return original.shares;return splitTripAmount(expense.amount,expense.selected||[],expense.custom?expense.shares:null);}
 function saveExpense(){return action(async()=>{if(!trip||trip.completed)throw new Error('Reopen this trip before logging or editing expenses.');if(!expense.reason.trim())throw new Error('Enter what this expense was for.');const shares=currentShares();await rpc(expense.id?'edit_trip_expense':'add_trip_expense',{...(expense.id?{p_request:request.current,p_id:expense.id,p_version:expense.version}:{p_id:request.current,p_trip:trip.id}),p_reason:expense.reason.trim(),p_amount:amountValue(expense.amount),p_payer:expense.payer==='me'?null:expense.payer,p_shares:shares,p_category:expense.category||null})},['trip_entries','profiles','debts','expenses'])}
 let preview=null;try{preview=currentShares()}catch{}
 const chip=(id,label,selected,onClick)=><button className="trip-chip" type="button" key={id} aria-pressed={selected} onClick={onClick}>{label}</button>;
 const ready=entries.hasData&&members.hasData&&!ledgerLoading;
 const skeleton=<div className="trip-skeleton"><LoadingState label="loading trip"/><span/><span/></div>;
 return <main className="trips-page">
  <Link href="/dashboard" className="trip-back">← home</Link>
  <header className="trips-heading"><h1>trips</h1>{activeId&&<button disabled={busy} className="primary-action" onClick={()=>openTrip()}>+ new trip</button>}</header>
  <AccountSwitcher profiles={profiles} activeId={activeId} onChange={id=>{if(operation.current)return;switchProfile(id);setSelected(null);setModal(null);setDeleting(null);setError("")}}/>
  {(dataError||trips.error||entries.error||members.error||error)&&<div role="alert" className="trip-caption">{error||dataError?.message||trips.error?.message||entries.error?.message||members.error?.message}{(dataError||trips.error||entries.error||members.error)&&<button className="trip-back" onClick={()=>queryCache.invalidate(['trips','trip_members','trip_entries','profiles','people','debts'])}>retry</button>}</div>}
  {!trip?<div>{!trips.hasData&&!trips.error?<>{skeleton}{skeleton}</>:!trips.data.length?<div className="trip-empty"><h2>your next trip</h2><p>Plan a budget. Split the costs.<br/>Keep it all in one place.</p></div>:trips.data.map(t=><button className="trip-card" key={t.id} onClick={()=>setSelected(t.id)}><span><strong>{t.name}</strong><small>{t.starts_on} — {t.ends_on}{t.completed?' · completed':''}</small></span><span aria-hidden="true">›</span></button>)}</div>:<>
   <button className="trip-back" onClick={()=>setSelected(null)}>← all trips</button><h2 className="trip-title">{trip.name}</h2><p className="trip-caption">{trip.starts_on} — {trip.ends_on}</p>
   {!ready?skeleton:<div className="trip-summary"><small>total trip spending</small><p className="trip-total">{fmt(total)}</p><p className="trip-caption">your share {fmt(own)}{Number(trip.budget)>0&&` · ${fmt(Math.abs(Number(trip.budget)-total))} ${total>Number(trip.budget)?'over overall':'remaining overall'}`}</p><p className="trip-caption">{Number(trip.personal_budget)>0?"personal "+fmt(trip.personal_budget)+" · "+fmt(Math.abs(trip.personal_budget-own))+(own>trip.personal_budget?" over":" remaining"):"personal not set"}</p></div>}
   <div className="trip-actions">{!trip.completed&&<button className="primary-action" disabled={!ready||busy} onClick={()=>openExpense()}>+ log expense</button>}<Link className="trip-glass trip-icon-action" href={"/trips/"+trip.id+"/statistics"} aria-label="Trip statistics" title="Trip statistics"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 20h16M7 16V9m5 7V4m5 12v-5"/></svg></Link><details className="trip-menu"><summary className="trip-glass" aria-label="Trip options">•••</summary><div><button disabled={!ready||busy} onClick={()=>openTrip(true)}>edit trip</button><button disabled={!ready||busy} onClick={()=>action(()=>rpc('complete_trip',{p_trip:trip.id,p_completed:!trip.completed}),['trips'])}>{trip.completed?'reopen trip':'finish trip'}</button></div></details></div>
   {ready&&<><div className="trip-section-heading"><h3>settlement</h3><Link className="trip-glass" href="/owes">open Tabs ↗</Link></div><p className="trip-caption">Payments in Tabs include your other balances with each person.</p>
   {people.filter(p=>outstanding.some(d=>d.person_id===p.id)).map(p=>{const net=outstanding.filter(d=>d.person_id===p.id).reduce((sum,d)=>sum+(d.direction==='they_owe_me'?1:-1)*Number(d.remaining_amount),0);return <p key={p.id} style={{fontSize:12}}>{p.name} · {net>=0?'owes you':'you owe'} {fmt(Math.abs(net))}</p>})}
   {!outstanding.length&&<p style={{fontSize:12}}>all clear</p>}
   <h3 style={{fontSize:12,marginTop:26}}>expenses</h3>{entries.data.length===0?<p style={{fontSize:12,color:'var(--muted)'}}>No expenses yet.</p>:[...entries.data].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(e=><button type="button" className="trip-expense-row" key={e.id} disabled={busy||!ready} onClick={()=>openExpense(e)} aria-label={"Edit "+e.reason} style={{padding:'14px 0',borderBottom:'1px solid var(--border-light)',display:'flex',justifyContent:'space-between',gap:12}}><div>{e.reason}<p style={{fontSize:11,color:'var(--muted)'}}>{e.payer?people.find(p=>p.id===e.payer)?.name||'participant':'you'} paid · your share {fmt(e.shares.me||0)}</p></div><div style={{textAlign:'right'}}><span>{fmt(e.amount)}</span></div></button>)}
  </>}</>}
  {deleting&&<Modal busy={busy} title={`delete ${deleting.kind}`} onClose={()=>!busy&&setDeleting(null)} style={{background:'var(--bg)',width:'100%',maxWidth:440,padding:24,borderRadius:22}}><h2 style={{fontSize:16}}>delete {deleting.kind}?</h2><p className="trip-caption">{deleting.kind==='trip'?'Removes the trip and its bill summaries. Recorded expenses, balances and Tabs stay. This cannot be undone.':'Reverses this bill’s cash movement and removes its linked expense and open Tabs. Changed or settled records are protected. This cannot be undone.'}</p>{error&&<p role="alert">{error}</p>}<div className="settings-actions"><button disabled={busy} onClick={()=>setDeleting(null)}>cancel</button><button className="primary-action" disabled={busy} onClick={()=>action(async()=>{await rpc(deleting.kind==='trip'?'delete_trip':'delete_trip_expense',deleting.kind==='trip'?{p_trip:deleting.id}:{p_id:deleting.id,p_version:deleting.version??1});if(deleting.kind==='trip')setSelected(null);setDeleting(null)})}>{busy?'deleting…':'delete'}</button></div></Modal>}
  {modal&&!deleting&&<Modal busy={busy} onSubmit={modal==="trip"?saveTrip:saveExpense} title={modal==='trip'?'trip details':'trip expense'} onClose={()=>!busy&&setModal(null)} style={{background:'var(--bg)',width:'100%',maxWidth:440,padding:24,borderRadius:22}}><fieldset disabled={busy} className="trip-form" style={{display:"grid",gap:18,border:0,padding:0,margin:0,minWidth:0}}>
   <h2 style={{fontSize:16}}>{modal==='trip'?'trip details':expense.id?'edit expense':'trip expense'}</h2>
   {modal==='expense'&&expense.id&&<p className="trip-caption">Updates this bill, your balance and its open Tabs together. Editing is blocked if linked records or payments changed. Reopen a completed trip first.</p>}
   {modal==='trip'?<><label>name<input autoFocus required maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>total trip budget (optional)<AmountInput inputMode="decimal" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></label><label>your personal budget (optional)<AmountInput value={form.personalBudget} onChange={e=>setForm({...form,personalBudget:e.target.value})}/></label><small className="trip-caption">Overall covers full bills. Personal covers your allocated share, whoever pays. Blank or zero means no limit.</small><div style={{display:'flex',gap:12}}><label>from<input required type="date" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label><label>to<input required type="date" min={form.start} value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></label></div><label>participants · you are included<input placeholder="search or add a person" value={search} onChange={e=>setSearch(e.target.value)}/></label><div style={{display:'flex',gap:6,overflowX:'auto'}}>{people.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=>chip(p.id,p.name,form.people.includes(p.id),()=>setForm({...form,people:form.people.includes(p.id)?form.people.filter(id=>id!==p.id):[...form.people,p.id]})))}</div>{search.trim()&&!people.some(p=>p.name.toLowerCase()===search.trim().toLowerCase())&&<button type="button" disabled={busy} onClick={addPerson}>+ add “{search.trim()}”</button>}</>:<>
   <label>what for?<input autoFocus required maxLength={200} value={expense.reason} onChange={e=>setExpense({...expense,reason:e.target.value})}/></label><label>total amount<AmountInput required inputMode="decimal" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})}/></label><label>paid by<select value={expense.payer} onChange={e=>setExpense({...expense,payer:e.target.value})}>{names.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><small>split between</small><div style={{display:'flex',gap:6,overflowX:'auto'}}>{names.map(n=>chip(n.id,n.name,expense.selected.includes(n.id),()=>setExpense({...expense,selected:expense.selected.includes(n.id)?expense.selected.filter(id=>id!==n.id):[...expense.selected,n.id]})))}</div><label><input type="checkbox" checked={expense.custom} onChange={e=>setExpense({...expense,custom:e.target.checked})}/> custom shares</label>{expense.custom&&expense.selected.map(id=><label key={id}>{names.find(n=>n.id===id)?.name}<AmountInput inputMode="decimal" placeholder={preview?String(preview[id]):'leave one blank to calculate'} value={expense.shares[id]||''} onChange={e=>setExpense({...expense,shares:{...expense.shares,[id]:e.target.value}})}/></label>)}<CategoryChips categories={categories} value={expense.category} onChange={category=>setExpense({...expense,category})}/><p style={{fontSize:11,color:'var(--muted)'}}>{expense.payer==='me'?'The full payment leaves this profile. Only your share is spending; the rest is owed to you in Tabs.':'Only your share becomes an amount you owe the payer in Tabs. Your balance changes when you record payment.'} Other participants’ debts to each other are not tracked.</p></>}
   {error&&<p role="alert">{error}</p>}<div style={{display:'flex',justifyContent:'flex-end',gap:12}}><button type="button" disabled={busy} onClick={()=>setModal(null)}>cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy?'saving…':'save'}</button></div>
   {((modal==="trip"&&form.editing)||(modal==="expense"&&expense.id))&&<button type="button" style={{color:"var(--muted)",borderTop:"1px solid var(--border-light)",paddingTop:20,textAlign:"left"}} disabled={busy} onClick={()=>{setError("");setDeleting(modal==="trip"?{kind:"trip",id:trip.id}:{kind:"expense",id:expense.id,version:expense.version})}}>delete {modal==="trip"?"trip":"expense"}</button>}
  </fieldset></Modal>}<Nav/>
 </main>
}
