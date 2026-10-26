"use client";
import {useState} from 'react';
import {useProfiles} from '../lib/useAppData';
import {useAuth} from '../lib/auth-context';
import {supabase} from '../lib/supabase';
import {expenseOutbox} from '../lib/offline-expenses';
import {queryCache} from '../lib/query-cache.mjs';

export default function ProfileSettings(){
 const {profiles}=useProfiles();const {user}=useAuth();
 const [target,setTarget]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const profile=profiles.find(p=>p.id===target);
 async function remove(){
  if(!profile||name!==profile.name||busy)return;
  setBusy(true);setError('');
  try{
   const pending=await expenseOutbox.list(user.id);
   if(pending.some(row=>row.payload.p_profile===profile.id))throw new Error('Sync or resolve this profile’s pending expenses first.');
   const {error}=await supabase.rpc('delete_profile',{p_profile:profile.id,p_name:name});if(error)throw error;
   queryCache.invalidate();setTarget('');setName('');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="settings-field">
  <label>profile <select disabled={busy} value={target} onChange={e=>{setTarget(e.target.value);setName('');setError('')}}><option value="">choose profile</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {profile&&<><p style={{fontSize:11,color:'var(--muted)'}}>Permanently deletes this profile, its balance, expenses, schedules, settled Tabs and linked transfer history. Other profiles’ balances stay unchanged. Export first. Resolve pending expenses on every device before continuing.</p><label>type “{profile.name}” to confirm<input disabled={busy} value={name} onChange={e=>setName(e.target.value)} autoComplete="off" /></label><button type="button" disabled={busy||name!==profile.name} onClick={remove}>{busy?'deleting…':'delete profile permanently'}</button></>}
  {error&&<p role="alert">{error}</p>}
 </div>
}
