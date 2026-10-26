"use client";
import {createExpenseOutbox,indexedOutbox} from './expense-outbox.mjs';
import {currentAccount} from './supabase-auth';
import {queryCache} from './query-cache.mjs';
let identity=null;
export function activateOutbox(user,authUser) { identity=user && authUser ? {owner:user.id,uid:authUser.uid} : null; }
const active=owner=>identity?.owner===owner && currentAccount()?.uid===identity.uid;
export const expenseOutbox=createExpenseOutbox({store:indexedOutbox(),isActive:active,
  notify:()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('expense-outbox'));},
  send:async(owner,payload)=>{
    if(!active(owner))throw new Error('Sign in again to sync your pending expenses.');
    const user=currentAccount(),token=await user.getIdToken();
    if(!active(owner) || user.uid!==identity?.uid)throw new Error('Account changed. Draft kept for its original account.');
    // Capture the token: a later account switch must never retarget this write.
    const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ios_add_expense`,{
      method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),
    });
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(new Error(data.message || 'Could not sync. Please retry.'),{permanent:response.status<500 && ![408,429,401].includes(response.status)});}
    if(active(owner))queryCache.invalidate(['profiles','expenses']);
  },
});
