"use client";
import {useState} from 'react';
import {useCategories} from '../lib/useAppData';
import {supabase} from '../lib/supabase';
import {queryCache} from '../lib/query-cache.mjs';
import {toCSV} from '../lib/csv.mjs';
import {useAuth} from '../lib/auth-context';
import {currentAccount,signOut} from '../lib/supabase-auth';
import {resetSession} from '../lib/useAppData';
import {activateOutbox,expenseOutbox} from '../lib/offline-expenses';
export default function DataControls() {
  const {user,authUser}=useAuth();
  const [confirmation,setConfirmation]=useState(''),[deleting,setDeleting]=useState(false);
  const categories=useCategories();
  const [editing,setEditing]=useState(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(row) {
    if(busy)return;setBusy(true);setError('');
    try { const {error}=await supabase.rpc('save_category',{p_id:row.id,p_name:row.name,p_order:row.sort_order ?? 0,p_archived:!!row.archived});if(error)throw error;queryCache.invalidate(['categories']);setEditing(null); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function exportRows(table,columns) {
    if(busy)return;setBusy(true);setError('');
    try {
      const rows=[];
      const token=await authUser.getIdToken();
      for(let offset=0;;offset+=1000){
        if(currentAccount()?.uid!==authUser.uid)throw new Error('Account changed. Export cancelled.');
        const params=new URLSearchParams({select:columns.join(','),order:'id.asc',offset:String(offset),limit:'1000'});
        const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${params}`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`}});
        const data=await response.json();if(!response.ok)throw new Error(data.message || 'Export failed.');
        rows.push(...data);if(data.length<1000)break;
      }
      if(currentAccount()?.uid!==authUser.uid)throw new Error('Account changed. Export cancelled.');
      const url=URL.createObjectURL(new Blob([toCSV(rows,columns)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`expensive-${table}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function deleteData() {
    if(busy || confirmation!=='DELETE EXPENSIVE DATA')return;
    setBusy(true);setError('');activateOutbox(null,null);
    try {
      const response=await fetch('/api/account/delete-data',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await authUser.getIdToken()}`},body:JSON.stringify({confirmation})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      await expenseOutbox.clear(user.id);resetSession();await signOut();window.location.replace('/');
    }catch(e){setError(e.message);activateOutbox(user,authUser);}finally{setBusy(false);}
  }
  return <section className="data-tools"><h3>your data</h3>
    <p className="muted">Export all your profiles. Files contain personal financial information—store them safely.</p>
    <div className="tool-actions">
      <button type="button" disabled={busy} onClick={()=>exportRows('expenses',['id','profile_id','reason','amount','category_id','notes','created_at'])}>expenses CSV</button>
      <button type="button" disabled={busy} onClick={()=>exportRows('debts',['id','profile_id','person_id','direction','amount','remaining_amount','description','created_at','settled_at'])}>tabs CSV</button>
      <button type="button" disabled={busy} onClick={()=>exportRows('account_activity',['id','profile_id','person_id','title','kind','amount','balance_delta','created_at','undone_at'])}>activity CSV</button>
    </div>
    <h3 style={{marginTop:20}}>categories</h3><p className="muted">Archiving hides a category from new expenses but keeps its history.</p>
    {categories.map((c,i)=><div className="tool-row" key={c.id}>{c.name}{c.archived?' · archived':''}<div className="tool-actions">
      <button type="button" disabled={busy} onClick={()=>{setEditing(c);setName(c.name);}}>rename</button>
      <button type="button" disabled={busy} onClick={()=>save({...c,archived:!c.archived})}>{c.archived?'restore':'archive'}</button>
      <button type="button" disabled={busy || i===0} aria-label={`Move ${c.name} up`} onClick={()=>save({...c,sort_order:(categories[i-1].sort_order ?? 0)-1})}>↑</button>
      <button type="button" disabled={busy || i===categories.length-1} aria-label={`Move ${c.name} down`} onClick={()=>save({...c,sort_order:(categories[i+1].sort_order ?? 0)+1})}>↓</button>
    </div></div>)}
    {editing ? <div className="expense-fields"><label>category name<input maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><div className="tool-actions"><button type="button" disabled={busy} onClick={()=>setEditing(null)}>cancel</button><button type="button" disabled={busy || !name.trim()} className="primary-action" onClick={()=>save({...editing,name})}>save</button></div></div>
    : <button type="button" disabled={busy} onClick={()=>{setEditing({id:crypto.randomUUID(),sort_order:(categories.at(-1)?.sort_order ?? 0)+1,archived:false});setName('');}}>add category</button>}
    <div className="data-tools"><button type="button" disabled={busy} onClick={()=>setDeleting(v=>!v)}>delete Expensive data…</button>
      {deleting && <div className="expense-fields"><p className="muted">Permanently deletes your profiles, balances, expenses, tabs, activity and schedules from Expensive. Your Expensive sign-in remains available. Export first. Sign in again if requested. This cannot be undone.</p>
      <label>type DELETE EXPENSIVE DATA<input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button type="button" disabled={busy || confirmation!=='DELETE EXPENSIVE DATA'} onClick={deleteData}>permanently delete my data</button></div>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
