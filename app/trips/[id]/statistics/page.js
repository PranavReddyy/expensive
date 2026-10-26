'use client';
import {useParams} from 'next/navigation';
import Link from 'next/link';
import {useQuery,useCategories,usePeople,useDebts,useProfiles} from '../../../../lib/useAppData';
import {supabase} from '../../../../lib/supabase';
import {fmt} from '../../../../lib/format';
import {tripStatistics} from '../../../../lib/trips.mjs';
import LoadingState from '../../../../components/LoadingState';
import {usePreferences} from '../../../../components/Preferences';

const columns={trips:'id,profile_id,name,budget,personal_budget,starts_on,ends_on,completed,created_at',trip_entries:'id,trip_id,reason,amount,payer,shares,category_id,created_at,version'};
async function rows(table,key,id,signal){let result=[];for(let offset=0;;offset+=1000){const {data,error}=await supabase.from(table).select(columns[table]).eq(key,id).order('id').range(offset,offset+999).abortSignal(signal);if(error)throw error;result.push(...data);if(data.length<1000)return result;}}
export default function Statistics(){
 usePreferences();const {id}=useParams();const ledger=useProfiles();
 const tripQuery=useQuery(['trip-stat',id],['trips'],s=>rows('trips','id',id,s),!!id);
 const bills=useQuery(['trip-entries',id],['trip_entries'],s=>rows('trip_entries','trip_id',id,s),!!id);
 const trip=tripQuery.data[0],categories=useCategories(),people=usePeople(trip?.profile_id),allDebts=useDebts(trip?.profile_id);
 const error=tripQuery.error||bills.error||ledger.dataError;
 if(error)return <main className="trips-page"><Link href="/trips">← trips</Link><p role="alert">{error.message}</p></main>;
 if(!tripQuery.hasData||!bills.hasData||ledger.loading)return <main className="trips-page"><LoadingState label="loading statistics"/></main>;
 if(!trip)return <main className="trips-page"><Link href="/trips">← trips</Link><p>Trip not found.</p></main>;
 const entries=bills.data,total=entries.reduce((n,e)=>n+Number(e.amount),0),stats=tripStatistics(entries,trip.starts_on,trip.ends_on),debts=allDebts.filter(d=>d.trip_id===id);
 const groups=new Map(),participants=new Set(['me']);
 for(const e of entries){const key=e.category_id||'';groups.set(key,(groups.get(key)||0)+Number(e.amount));Object.keys(e.shares).forEach(p=>participants.add(p));if(e.payer)participants.add(e.payer);}
 const row=(name,value)=><div key={name} style={{display:'flex',justifyContent:'space-between',gap:16,padding:'9px 0',fontSize:12}}><span style={{color:'var(--muted)'}}>{name}</span><span style={{textAlign:'right'}}>{value}</span></div>;
 const section={borderTop:'1px solid var(--border-light)',marginTop:24,paddingTop:16};
 return <main className="trips-page"><Link href={`/trips?trip=${id}`} className="trip-back">← back to trip</Link><h1 style={{fontSize:22}}>trip statistics</h1><p className="trip-caption">{trip.name} · {trip.starts_on} — {trip.ends_on}</p>
 <div className="trip-summary"><small>total trip spending</small><p className="trip-total">{fmt(total)}</p>{row('your share',fmt(entries.reduce((n,e)=>n+Number(e.shares.me||0),0)))}{row('you paid upfront',fmt(entries.filter(e=>!e.payer).reduce((n,e)=>n+Number(e.amount),0)))}</div>
 <section style={section}><h2 style={{fontSize:13}}>overview</h2>{row('bills',stats.count)}{row('scheduled trip days',stats.days)}{row('per scheduled day',fmt(stats.daily))}{row('average bill',fmt(stats.count?total/stats.count:0))}{Number(trip.budget)>0&&<>{row('overall budget',fmt(trip.budget))}{row(total>trip.budget?'over budget':'remaining budget',fmt(Math.abs(trip.budget-total)))}<progress aria-label="Budget used" max="100" value={Math.min(100,total/Number(trip.budget)*100)} style={{width:'100%',accentColor:'var(--text)'}}/></>}</section>
 <section style={section}><h2 style={{fontSize:13}}>personal budget</h2>{Number(trip.personal_budget)>0?<>{row("your budget",fmt(trip.personal_budget))}{row("your share",fmt(entries.reduce((n,e)=>n+Number(e.shares.me||0),0)))}{row("remaining / over",fmt(Number(trip.personal_budget)-entries.reduce((n,e)=>n+Number(e.shares.me||0),0)))}<p className="trip-caption">A negative remainder means you are over your personal budget. Based on your allocated share, not what you paid upfront.</p><progress aria-label="Personal budget used" max="100" value={Math.min(100,entries.reduce((n,e)=>n+Number(e.shares.me||0),0)/Number(trip.personal_budget)*100)} style={{width:"100%",accentColor:"var(--text)"}}/></>:<p className="trip-caption">Not set. Add your personal budget in Edit trip.</p>}</section>
 <section style={section}><h2 style={{fontSize:13}}>by category · full bills</h2>{[...groups].sort((a,b)=>b[1]-a[1]).map(([key,value])=>row(categories.find(c=>c.id===key)?.name||'uncategorized',fmt(value)))}</section>
 <section style={section}><h2 style={{fontSize:13}}>participants</h2>{[...participants].map(p=><div key={p} style={{marginTop:16}}><h3 style={{fontSize:12}}>{p==='me'?'you':people.find(person=>person.id===p)?.name||'participant'}</h3>{row('paid upfront',fmt(entries.filter(e=>(e.payer||'me')===p).reduce((n,e)=>n+Number(e.amount),0)))}{row('allocated share',fmt(entries.reduce((n,e)=>n+Number(e.shares[p]||0),0)))}</div>)}</section>
 <section style={section}><h2 style={{fontSize:13}}>open Tabs · your balances only</h2>{row('owed to you',fmt(debts.filter(d=>d.direction==='they_owe_me').reduce((n,d)=>n+Number(d.remaining_amount),0)))}{row('you owe',fmt(debts.filter(d=>d.direction==='i_owe_them').reduce((n,d)=>n+Number(d.remaining_amount),0)))}</section>
 <section style={section}><h2 style={{fontSize:13}}>largest bills</h2>{[...entries].sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5).map(e=><div key={e.id}>{row(e.reason,fmt(e.amount))}</div>)}</section>{!entries.length&&<p className="trip-caption">Log a trip expense to see breakdowns.</p>}
 </main>;
}
