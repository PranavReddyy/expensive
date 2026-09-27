"use client";
import { useMemo, useState } from "react";
import { useProfiles, usePeople, useDebts } from "../../lib/useAppData";
import { summarizeTabs, splitAmount } from "../../lib/tabs.mjs";
import { queryCache } from "../../lib/query-cache.mjs";
import { fmt } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import Modal from "../../components/Modal";
import DataStatus from "../../components/DataStatus";
import Nav from "../../components/Nav";
import AccountSwitcher from "../../components/AccountSwitcher";

export default function TabsPage() {
  const { profiles, activeId, switchProfile, loading, dataError } = useProfiles();
  const people = usePeople(activeId), debts = useDebts(activeId);
  const totals = useMemo(() => summarizeTabs(debts), [debts]);
  const active = profiles.find(p => p.id === activeId);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tabDirection, setTabDirection] = useState("all");
  const [sortHighToLow, setSortHighToLow] = useState(false);
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [extraPeople, setExtraPeople] = useState([]);
  const [direction, setDirection] = useState("they_owe_me");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [includesYou, setIncludesYou] = useState(true);
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allPeople = [...people, ...extraPeople.filter(p => !people.some(x => x.id === p.id))];
  function open(type, p) {
    setModal(type); setError(""); setQuery(""); setSelected([]); setAmount("");
    setDescription(""); setIncludesYou(true); setDirection("they_owe_me");
    if (p) {
      const t = totals.people.get(p.id) || { collect: 0, pay: 0, entries: [] };
      setPerson({ ...p, ...t }); setAmount(String(Math.abs(t.collect-t.pay)/100));
    }
  }
  function close() { if (!busy) setModal(null); }
  async function createPerson() {
    if (!query.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const { data, error } = await supabase.from("people").insert({ profile_id: activeId, name: query.trim() }).select().single();
      if (error) throw error;
      setExtraPeople(rows => [...rows, data]);
      setSelected(ids => modal === "split" ? [...ids, data.id] : [data.id]); setQuery("");
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    if (busy) return;
    setError(""); setBusy(true);
    try {
      let result;
      if (modal === "settle") {
        if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Enter an amount with up to two decimals.");
        result = await supabase.rpc("settle_tab", { p_profile: activeId, p_person: person.id,
          p_payment: Number(amount), p_expected_collect: person.collect/100, p_expected_pay: person.pay/100 });
      } else {
        if (!selected.length) throw new Error("Search for a person or add a new name.");
        if (!description.trim()) throw new Error("Add what this is for.");
        if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error("Enter an amount with up to two decimals.");
        const split = modal === "split" ? splitAmount(amount, selected.length, includesYou) : { amounts: [Number(amount)], ownShare: 0 };
        result = await supabase.rpc("add_tab", { p_profile: activeId, p_own_share: split.ownShare,
          p_rows: selected.map((id,i) => ({ person_id: id, amount: split.amounts[i],
            direction: modal === "split" ? "they_owe_me" : direction, description: description.trim() })) });
      }
      if (result.error) throw result.error;
      queryCache.invalidate(["profiles","debts","expenses","people"]); setModal(null);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  let preview;
  if (modal === "split" && selected.length && Number(amount) > 0) {
    try { preview = splitAmount(amount, selected.length, includesYou); } catch {}
  }
  if (loading || (dataError && !profiles.length)) return <DataStatus error={dataError} />;
  const matches = allPeople.filter(p => p.profile_id === activeId && p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const visiblePeople = people
    .filter(p => {
      const tab = totals.people.get(p.id);
      const net = (tab?.collect || 0) - (tab?.pay || 0);
      return p.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        (tabDirection === "all" || (tabDirection === "owed" && net > 0) || (tabDirection === "owing" && net < 0));
    })
    .sort((a, b) => {
      if (sortHighToLow) {
        const aTab = totals.people.get(a.id), bTab = totals.people.get(b.id);
        const aNet = Math.abs((aTab?.collect || 0) - (aTab?.pay || 0));
        const bNet = Math.abs((bTab?.collect || 0) - (bTab?.pay || 0));
        if (aNet !== bNet) return bNet - aNet;
      }
      return a.name.localeCompare(b.name);
    });
  return <div style={s.page}>
    <div style={s.header}>TABS</div>
    <AccountSwitcher profiles={profiles} activeId={activeId} onChange={switchProfile} />
    {active ? <>
      <div style={s.balance}><p style={s.muted}>current balance</p><p style={s.big}>{fmt(active.balance)}</p>
        <p style={s.muted}>owed to you {fmt(totals.collect)} · you owe {fmt(totals.pay)}</p>
        <p style={s.muted}>after settlement {fmt(Number(active.balance)+totals.collect-totals.pay)}</p></div>
      <div style={s.actions}>
        <button type="button" style={s.button} onClick={() => open("add")}>+ add amount</button>
        <button type="button" style={s.button} onClick={() => open("split")}>split a payment</button>
        <button type="button" style={{ ...s.button, ...(tabDirection !== "all" || sortHighToLow ? s.active : {}) }}
          onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} aria-controls="tab-filters">
          filter{tabDirection !== "all" || sortHighToLow ? " ·" : ""}
        </button>
      </div>
      {filtersOpen && <div id="tab-filters" style={s.filterPanel}>
        <div style={s.filterGroup} aria-label="Filter tabs by direction">
          {[["all", "all"], ["owed", "owed to me"], ["owing", "I owe"]].map(([value, label]) =>
            <button type="button" key={value} aria-pressed={tabDirection === value}
              style={{ ...s.button, ...(tabDirection === value ? s.active : {}) }}
              onClick={() => setTabDirection(value)}>{label}</button>)}
        </div>
        <button type="button" aria-pressed={sortHighToLow}
          style={{ ...s.button, ...(sortHighToLow ? s.active : {}) }}
          onClick={() => setSortHighToLow(value => !value)}>amount: high to low</button>
      </div>}
      <input style={s.input} aria-label="Search tabs" placeholder="search people" value={search} onChange={e => setSearch(e.target.value)} />
      {visiblePeople.map(p => {
        const t = totals.people.get(p.id) || { collect: 0, pay: 0 };
        const net = t.collect-t.pay;
        return <div key={p.id} style={s.row}><div style={{minWidth:0, flex:1}}><p style={s.name}>{p.name}</p>
          <p style={s.muted}>{net > 0 ? "owes you" : net < 0 ? "you owe" : t.collect ? "amounts cancel out" : "settled"}</p>
          {t.collect > 0 && t.pay > 0 && <p style={s.muted}>owed {fmt(t.collect/100)} · owing {fmt(t.pay/100)}</p>}</div>
          <div style={{textAlign:"right"}}><p>{fmt(Math.abs(net)/100)}</p>{(t.collect+t.pay)>0 && <button style={s.button} onClick={() => open("settle",p)}>{net === 0 ? "clear tab" : "record payment"}</button>}</div></div>;
      })}
      {!visiblePeople.length && <p style={s.muted}>{people.length ? "No matching tabs." : "Add an amount to start your first tab."}</p>}
    </> : <p>Create a profile from Home first.</p>}
    {modal && <Modal title={modal === "settle" ? person.name : "Add to tabs"} onClose={close} onSubmit={save} busy={busy} onError={e => setError(e.message)} style={s.modal}>
      <p style={s.header}>{modal === "settle" ? person.name : modal === "split" ? "split a payment" : "add amount"}</p>
      {modal !== "settle" ? <>
        <label style={s.muted}>people</label>
        <div style={s.actions}>{selected.map(id => <button type="button" style={s.button} key={id} onClick={() => setSelected(ids => ids.filter(x => x !== id))}>{allPeople.find(p => p.id === id)?.name} ×</button>)}</div>
        <input style={s.input} aria-label="Search or add person" placeholder="search or add a name" value={query} onChange={e => setQuery(e.target.value)} />
        {query.trim() && <div style={s.results}>{matches.map(p => <button type="button" style={s.result} key={p.id} onClick={() => { setSelected(ids => modal === "split" ? [...new Set([...ids,p.id])] : [p.id]); setQuery(""); }}>{p.name}</button>)}
          {!matches.some(p => p.name.toLowerCase() === query.trim().toLowerCase()) && <button type="button" disabled={busy} style={s.result} onClick={createPerson}>+ add “{query.trim()}”</button>}</div>}
        {modal === "add" && <div style={s.actions}>{[["they_owe_me","they owe me"],["i_owe_them","I owe them"]].map(([id,label]) => <button type="button" key={id} style={{...s.button,...(direction === id ? s.active : {})}} onClick={() => setDirection(id)}>{label}</button>)}</div>}
        <label style={s.muted}>what was it for?</label><input style={s.input} value={description} onChange={e => setDescription(e.target.value)} aria-label="Description" />
      </> : <><p style={s.muted}>{person.collect > person.pay ? "Payment received from them" : person.collect < person.pay ? "Payment you made to them" : "Clear matching amounts without moving money"}</p>
        <p style={s.muted}>net remaining {fmt(Math.abs(person.collect-person.pay)/100)}</p>
        {person.collect > 0 && person.pay > 0 && <p style={s.muted}>{fmt(Math.min(person.collect,person.pay)/100)} cancels out in both directions when confirmed.</p>}
        <details style={{margin:"10px 0"}}><summary style={s.muted}>view entries</summary>{person.entries.map(d => <p style={s.muted} key={d.id}>{d.description} · {d.direction === "they_owe_me" ? "owed to you" : "you owe"} {fmt(d.remaining_amount)}</p>)}</details></>}
      <label style={s.muted}>{modal === "split" ? "total you paid (₹)" : "amount (₹)"}</label>
      <input style={s.input} inputMode="decimal" aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
      {modal === "split" && <><label style={s.muted}><input type="checkbox" style={{appearance:"auto",marginRight:8}} checked={includesYou} onChange={e => setIncludesYou(e.target.checked)} />include my share</label>
        {preview && <div style={{marginTop:8}}>{selected.map((id,i) => <p style={s.muted} key={id}>{allPeople.find(p => p.id === id)?.name}: {fmt(preview.amounts[i])}</p>)}{includesYou && <p style={s.muted}>your expense: {fmt(preview.ownShare)}</p>}</div>}</>}
      <p style={{...s.muted,marginTop:10}}>{modal === "split" ? "The full payment leaves your balance. Only your share is logged as an expense." : modal === "add" ? direction === "they_owe_me" ? "This amount leaves your balance now." : "Your balance changes when you record payment." : person.collect < person.pay ? "This payment leaves your balance and is logged as an expense." : person.collect > person.pay ? "This payment is added to your balance." : "Your balance stays the same."}</p>
      {error && <p role="alert" style={{color:"#b00",fontSize:11}}>{error}</p>}
      <div style={{...s.actions,marginTop:16}}><button type="button" style={s.button} disabled={busy} onClick={close}>cancel</button><button type="submit" style={{...s.button,...s.active}} disabled={busy}>{busy ? "saving…" : modal === "settle" ? "confirm" : "save"}</button></div>
    </Modal>}<Nav />
  </div>;
}
const s = {
  page:{maxWidth:480,margin:"0 auto",padding:"20px 16px calc(var(--nav-h) + 20px)"},
  header:{fontSize:13,fontWeight:600,letterSpacing:"0.04em",marginBottom:20},
  actions:{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12},
  filterPanel:{border:"1px solid var(--border-light)",padding:10,marginBottom:12},
  filterGroup:{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8},
  button:{border:"1px solid var(--border-light)",background:"transparent",color:"var(--text)",padding:"7px 10px",fontSize:11},
  active:{borderColor:"#000",background:"var(--subtle)",fontWeight:600},
  balance:{border:"1px solid var(--border-light)",padding:14,marginBottom:14},
  big:{fontSize:28,fontWeight:600,marginBottom:8},
  muted:{fontSize:11,color:"var(--muted)",lineHeight:1.7},
  input:{width:"100%",border:"1px solid var(--border-light)",padding:10,marginBottom:10},
  row:{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid var(--border-light)"},
  name:{fontSize:13,fontWeight:500,overflowWrap:"anywhere"},
  modal:{background:"#fff",width:"100%",maxWidth:480,padding:20},
  results:{maxHeight:180,overflowY:"auto",marginBottom:12,border:"1px solid var(--border-light)"},
  result:{display:"block",width:"100%",textAlign:"left",padding:10,border:0,background:"transparent",color:"var(--text)"},
};
