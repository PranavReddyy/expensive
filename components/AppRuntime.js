"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";
import { queryCache } from "../lib/query-cache.mjs";
import { useAuth } from "../lib/auth-context";
import { activateOutbox,expenseOutbox } from '../lib/offline-expenses';
import { fmt } from '../lib/format';

export default function AppRuntime() {
  const path = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let active=true;
    navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(registration=>{
      if(active)registration.active?.postMessage({type:'WARM',path});
    }).catch(()=>{});
    return()=>{active=false;};
  },[path]);
  const authenticatedPage = usePathname() !== "/";
  const { user, authUser, validating } = useAuth();
  const [pending,setPending]=useState([]),[online,setOnline]=useState(true),[outboxError,setOutboxError]=useState('');
  useEffect(()=>{
    if(!user || validating){activateOutbox(null,null);setPending([]);return;}
    activateOutbox(user,authUser);
    let alive=true;
    const update=()=>expenseOutbox.list(user.id).then(rows=>{if(alive)setPending(rows);}).catch(e=>{if(alive)setOutboxError(e.message);});
    const flush=()=>{setOnline(navigator.onLine);if(navigator.onLine)void expenseOutbox.flush(user.id).catch(e=>{if(alive)setOutboxError(e.message);});};
    const offline=()=>setOnline(false);
    update();flush();const timer=setInterval(flush,30000);
    window.addEventListener('expense-outbox',update);window.addEventListener('online',flush);window.addEventListener('offline',offline);
    return()=>{alive=false;activateOutbox(null,null);clearInterval(timer);window.removeEventListener('expense-outbox',update);window.removeEventListener('online',flush);window.removeEventListener('offline',offline);};
  },[user?.id,authUser?.uid,validating]);
  useEffect(() => {
    if (!authenticatedPage || !user || validating) return;
    let connected = false;
    let interrupted = false;
    const changedTables=new Set();let changeTimer;
    const changed=table=>{
      changedTables.add(table);clearTimeout(changeTimer);
      changeTimer=setTimeout(()=>{queryCache.invalidate([...changedTables]);changedTables.clear();},150);
    };
    const channel = supabase.channel(`app-data:${user.id}`);
    for (const table of ["profiles", "categories", "expenses", "people", "debts", "account_activity", "recurring_expenses", "trips", "trip_members", "trip_entries"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table },
        () => changed(table));
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Catch changes missed between loading cached data and reconnecting.
        if (interrupted) queryCache.invalidate();
        connected = true;
        interrupted = false;
      } else if (connected || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        interrupted = true;
      }
    });
    const reconcile = () => queryCache.invalidate();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reconcile(); }, 120000);
    const visible = () => { if (document.visibilityState === "visible") reconcile(); };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", reconcile);
      window.clearInterval(timer);
      clearTimeout(changeTimer);
      document.removeEventListener("visibilitychange", visible);
      supabase.removeChannel(channel);
    };
  }, [authenticatedPage, user?.id, validating]);
  if(!user || validating)return null;
  return (pending.length || !online || outboxError) ? <aside className="sync-status" role="status">
    {!online?'offline · ':''}{pending.length?`${pending.length} pending expense${pending.length===1?'':'s'} · ${fmt(pending.reduce((n,r)=>n+Number(r.payload.p_amount),0))} not yet confirmed`:outboxError || 'showing saved data'}
    {pending.length>0 && <><button type="button" onClick={()=>expenseOutbox.flush(user.id,{retry:true}).catch(e=>setOutboxError(e.message))}>retry sync</button>{pending.find(r=>r.error)?.error && <p>{pending.find(r=>r.error).error}</p>}</>}
    {pending.length>0 && <details><summary>pending expenses</summary>{pending.map(row=><div key={row.key}>{row.payload.p_reason} · {fmt(row.payload.p_amount)}{row.blocked && <button type="button" onClick={()=>{
      if(confirm(`Discard rejected draft “${row.payload.p_reason}”?`))expenseOutbox.discardRejected(user.id,row.payload.p_id).catch(e=>setOutboxError(e.message));
    }}>discard rejected draft</button>}</div>)}</details>}
  </aside> : null;
}
