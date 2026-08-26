"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "../../components/Nav";
import { supabase } from "../../lib/supabase";

const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const emptyDebt = {
  person_id: "",
  direction: "they_owe_me",
  amount: "",
  description: "",
};

export default function OwesPage() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [people, setPeople] = useState([]);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [personName, setPersonName] = useState("");
  const [debtForm, setDebtForm] = useState(emptyDebt);
  const [splitForm, setSplitForm] = useState({
    description: "",
    amount: "",
    people: [],
    includesYou: true,
  });
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (!data) return;
    setProfiles(data);
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem("activeProfileId")
        : null;
    const validId =
      saved && data.some((profile) => profile.id === saved)
        ? saved
        : data[0]?.id;
    if (validId) setActiveId(validId);
    setLoading(false);
  }, []);

  const loadPeople = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("people")
      .select("*")
      .eq("profile_id", profileId)
      .order("name", { ascending: true });
    setPeople(data || []);
  }, []);

  const loadDebts = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("debts")
      .select("*, people(id, name)")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });
    setDebts(data || []);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeId) return;
    loadPeople(activeId);
    loadDebts(activeId);
  }, [activeId, loadDebts, loadPeople]);

  useEffect(() => {
    const channel = supabase
      .channel("owes-profiles")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        loadProfiles,
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeId) return;
    const channel = supabase
      .channel(`owes-${activeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "people" },
        () => loadPeople(activeId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debts" },
        () => loadDebts(activeId),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [activeId, loadDebts, loadPeople]);

  const openDebts = debts.filter((debt) => Number(debt.remaining_amount) > 0);
  const settledDebts = debts.filter((debt) => Number(debt.remaining_amount) === 0);
  const owedToYou = openDebts
    .filter((debt) => debt.direction === "they_owe_me")
    .reduce((sum, debt) => sum + Number(debt.remaining_amount), 0);
  const youOwe = openDebts
    .filter((debt) => debt.direction === "i_owe_them")
    .reduce((sum, debt) => sum + Number(debt.remaining_amount), 0);

  const personBalances = useMemo(
    () =>
      people.map((person) => {
        const personDebts = openDebts.filter(
          (debt) => debt.person_id === person.id,
        );
        const theyOwe = personDebts
          .filter((debt) => debt.direction === "they_owe_me")
          .reduce((sum, debt) => sum + Number(debt.remaining_amount), 0);
        const iOwe = personDebts
          .filter((debt) => debt.direction === "i_owe_them")
          .reduce((sum, debt) => sum + Number(debt.remaining_amount), 0);
        return { person, theyOwe, iOwe, net: theyOwe - iOwe };
      }),
    [openDebts, people],
  );

  function switchProfile(id) {
    setActiveId(id);
    localStorage.setItem("activeProfileId", id);
  }

  function openModal(type, debt = null) {
    setErr("");
    if (type === "person") setPersonName("");
    if (type === "debt") setDebtForm(emptyDebt);
    if (type === "split") {
      setSplitForm({
        description: "",
        amount: "",
        people: [],
        includesYou: true,
      });
    }
    if (type === "payment" && debt) {
      setSelectedDebt(debt);
      setPaymentAmount(String(debt.remaining_amount));
    }
    setModal(type);
  }

  function closeModal() {
    if (submitting) return;
    setModal(null);
    setSelectedDebt(null);
    setErr("");
  }

  async function addPerson() {
    const name = personName.trim();
    if (!name) {
      setErr("enter a name");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("people")
      .insert({ profile_id: activeId, name });
    if (error) {
      setErr(error.code === "23505" ? "this person already exists" : error.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    closeModal();
    loadPeople(activeId);
  }

  async function addDebt() {
    const amount = Number(debtForm.amount);
    if (!debtForm.person_id) {
      setErr("choose a person");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("enter a valid amount");
      return;
    }
    if (!debtForm.description.trim()) {
      setErr("add a description");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("debts").insert({
      profile_id: activeId,
      person_id: debtForm.person_id,
      direction: debtForm.direction,
      amount,
      remaining_amount: amount,
      description: debtForm.description.trim(),
    });
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    closeModal();
    loadDebts(activeId);
  }

  async function addSplit() {
    const total = Number(splitForm.amount);
    const selectedPeople = splitForm.people;
    if (!splitForm.description.trim()) {
      setErr("add a description");
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setErr("enter a valid total");
      return;
    }
    if (selectedPeople.length === 0) {
      setErr("choose at least one person");
      return;
    }
    const divisor = selectedPeople.length + (splitForm.includesYou ? 1 : 0);
    const paise = Math.round(total * 100);
    const baseShare = Math.floor(paise / divisor);
    const remainder = paise % divisor;
    const splitGroupId = crypto.randomUUID();
    const rows = selectedPeople.map((personId, index) => {
      const share = (baseShare + (index < remainder ? 1 : 0)) / 100;
      return {
        profile_id: activeId,
        person_id: personId,
        direction: "they_owe_me",
        amount: share,
        remaining_amount: share,
        description: splitForm.description.trim(),
        split_group_id: splitGroupId,
      };
    });

    setSubmitting(true);
    const { error } = await supabase.from("debts").insert(rows);
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    closeModal();
    loadDebts(activeId);
  }

  async function recordPayment() {
    if (!selectedDebt) return;
    const payment = Number(paymentAmount);
    const remaining = Number(selectedDebt.remaining_amount);
    if (!Number.isFinite(payment) || payment <= 0 || payment > remaining) {
      setErr(`enter an amount up to ${fmt(remaining)}`);
      return;
    }
    const nextRemaining = Math.max(0, Number((remaining - payment).toFixed(2)));
    setSubmitting(true);
    const { error } = await supabase
      .from("debts")
      .update({
        remaining_amount: nextRemaining,
        settled_at: nextRemaining === 0 ? new Date().toISOString() : null,
      })
      .eq("id", selectedDebt.id);
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    closeModal();
    loadDebts(activeId);
  }

  if (loading) {
    return <div style={s.center}>loading...</div>;
  }

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={s.header}>
          <div>
            <p style={s.logo}>OWES</p>
            <p style={s.subhead}>tracked separately from your balance</p>
          </div>
          <button style={s.smallBtn} onClick={() => openModal("person")}>
            + person
          </button>
        </div>

        {profiles.length > 0 && (
          <div style={s.tabs}>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                style={{ ...s.tab, ...(profile.id === activeId ? s.tabActive : {}) }}
                onClick={() => switchProfile(profile.id)}
              >
                {profile.name}
              </button>
            ))}
          </div>
        )}

        {!activeId ? (
          <p style={s.empty}>create a profile from home first.</p>
        ) : (
          <>
            <div style={s.summaryGrid}>
              <div style={s.summaryCard}>
                <p style={s.label}>owed to you</p>
                <p style={s.summaryValue}>{fmt(owedToYou)}</p>
              </div>
              <div style={s.summaryCard}>
                <p style={s.label}>you owe</p>
                <p style={s.summaryValue}>{fmt(youOwe)}</p>
              </div>
              <div style={{ ...s.summaryCard, ...s.netCard }}>
                <p style={s.label}>net</p>
                <p style={s.summaryValue}>{fmt(owedToYou - youOwe)}</p>
              </div>
            </div>

            <div style={s.actionRow}>
              <button style={s.primaryBtn} onClick={() => openModal("debt")}>
                + add amount
              </button>
              <button
                style={{ ...s.primaryBtn, ...s.secondaryBtn }}
                onClick={() => openModal("split")}
                disabled={people.length === 0}
              >
                split a payment
              </button>
            </div>
            {people.length === 0 && (
              <p style={s.hint}>add a person before creating an amount or split.</p>
            )}

            {openDebts.length > 0 ? (
              <section style={s.section}>
                <p style={s.sectionLabel}>open amounts</p>
                <div style={s.list}>
                  {openDebts.map((debt, index) => {
                    const theyOwe = debt.direction === "they_owe_me";
                    return (
                      <div
                        key={debt.id}
                        style={{ ...s.debtRow, ...(index === openDebts.length - 1 ? s.lastRow : {}) }}
                      >
                        <div style={s.debtMain}>
                          <div style={s.debtTopline}>
                            <p style={s.personName}>{debt.people?.name || "unknown"}</p>
                            <p style={s.amount}>{fmt(debt.remaining_amount)}</p>
                          </div>
                          <p style={s.description}>{debt.description}</p>
                          <p style={s.direction}>
                            {theyOwe ? "owes you" : "you owe"}
                            {Number(debt.amount) !== Number(debt.remaining_amount) &&
                              ` · ${fmt(debt.amount - debt.remaining_amount)} paid`}
                          </p>
                        </div>
                        <button style={s.settleBtn} onClick={() => openModal("payment", debt)}>
                          payment
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <p style={s.empty}>no open amounts yet.</p>
            )}

            {personBalances.length > 0 && (
              <section style={s.section}>
                <p style={s.sectionLabel}>people</p>
                <div style={s.list}>
                  {personBalances.map(({ person, theyOwe, iOwe, net }, index) => (
                    <div
                      key={person.id}
                      style={{ ...s.personRow, ...(index === personBalances.length - 1 ? s.lastRow : {}) }}
                    >
                      <p style={s.personName}>{person.name}</p>
                      <div style={s.personAmounts}>
                        {theyOwe > 0 && <span>they owe {fmt(theyOwe)}</span>}
                        {iOwe > 0 && <span>you owe {fmt(iOwe)}</span>}
                        {net === 0 && <span>settled</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {settledDebts.length > 0 && (
              <p style={s.settledNote}>{settledDebts.length} settled amount{settledDebts.length === 1 ? "" : "s"} kept in history.</p>
            )}
          </>
        )}
      </div>

      {modal && (
        <div style={s.overlay} onClick={closeModal}>
          <div style={s.modal} onClick={(event) => event.stopPropagation()}>
            {modal === "person" && (
              <>
                <p style={s.modalTitle}>add person</p>
                <input
                  autoFocus
                  style={s.input}
                  placeholder="name"
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addPerson()}
                />
                <ModalActions onCancel={closeModal} onConfirm={addPerson} busy={submitting} label="save person" />
              </>
            )}

            {modal === "debt" && (
              <>
                <p style={s.modalTitle}>add amount</p>
                <select
                  style={s.input}
                  value={debtForm.person_id}
                  onChange={(event) => setDebtForm({ ...debtForm, person_id: event.target.value })}
                >
                  <option value="">select person</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
                <div style={s.directionPicker}>
                  <button
                    style={{ ...s.directionButton, ...(debtForm.direction === "they_owe_me" ? s.directionActive : {}) }}
                    onClick={() => setDebtForm({ ...debtForm, direction: "they_owe_me" })}
                  >they owe me</button>
                  <button
                    style={{ ...s.directionButton, ...(debtForm.direction === "i_owe_them" ? s.directionActive : {}) }}
                    onClick={() => setDebtForm({ ...debtForm, direction: "i_owe_them" })}
                  >i owe them</button>
                </div>
                <input style={s.input} inputMode="decimal" placeholder="amount" value={debtForm.amount} onChange={(event) => setDebtForm({ ...debtForm, amount: event.target.value })} />
                <input style={s.input} placeholder="what was it for?" value={debtForm.description} onChange={(event) => setDebtForm({ ...debtForm, description: event.target.value })} />
                <ModalActions onCancel={closeModal} onConfirm={addDebt} busy={submitting} label="save amount" />
              </>
            )}

            {modal === "split" && (
              <>
                <p style={s.modalTitle}>split a payment</p>
                <p style={s.modalHint}>This creates one “owes you” amount for each selected person. It never changes your balance.</p>
                <input style={s.input} placeholder="what was it for?" value={splitForm.description} onChange={(event) => setSplitForm({ ...splitForm, description: event.target.value })} />
                <input style={s.input} inputMode="decimal" placeholder="total you paid" value={splitForm.amount} onChange={(event) => setSplitForm({ ...splitForm, amount: event.target.value })} />
                <label style={s.checkRow}>
                  <input type="checkbox" checked={splitForm.includesYou} onChange={(event) => setSplitForm({ ...splitForm, includesYou: event.target.checked })} />
                  <span>include my own share in the split</span>
                </label>
                <p style={s.modalLabel}>people to split with</p>
                <div style={s.peoplePicker}>
                  {people.map((person) => {
                    const checked = splitForm.people.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        style={{ ...s.personPick, ...(checked ? s.personPickActive : {}) }}
                        onClick={() => setSplitForm({
                          ...splitForm,
                          people: checked
                            ? splitForm.people.filter((id) => id !== person.id)
                            : [...splitForm.people, person.id],
                        })}
                      >{checked ? "✓ " : ""}{person.name}</button>
                    );
                  })}
                </div>
                <ModalActions onCancel={closeModal} onConfirm={addSplit} busy={submitting} label="create split" />
              </>
            )}

            {modal === "payment" && selectedDebt && (
              <>
                <p style={s.modalTitle}>record payment</p>
                <p style={s.modalHint}>{selectedDebt.people?.name || "person"} · {selectedDebt.direction === "they_owe_me" ? "paid you" : "you paid them"}</p>
                <p style={s.modalHint}>remaining: {fmt(selectedDebt.remaining_amount)}</p>
                <input autoFocus style={s.input} inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                <ModalActions onCancel={closeModal} onConfirm={recordPayment} busy={submitting} label="record payment" />
              </>
            )}

            {err && <p style={s.error}>// {err}</p>}
          </div>
        </div>
      )}
      <Nav />
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, busy, label }) {
  return (
    <div style={s.modalActions}>
      <button style={s.cancelBtn} onClick={onCancel}>cancel</button>
      <button style={s.confirmBtn} onClick={onConfirm} disabled={busy}>{busy ? "saving..." : label}</button>
    </div>
  );
}

const s = {
  page: { minHeight: "100vh", paddingBottom: "calc(var(--nav-h) + 16px)", maxWidth: "480px", margin: "0 auto" },
  wrap: { padding: "20px 16px 8px" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "12px" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px" },
  logo: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" },
  subhead: { fontSize: "10px", color: "var(--muted)", marginTop: "2px" },
  smallBtn: { border: "1px solid var(--border-light)", background: "transparent", padding: "5px 9px", fontSize: "10px", color: "var(--text)" },
  tabs: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" },
  tab: { fontSize: "11px", padding: "5px 12px", border: "1px solid var(--border-light)", background: "transparent", color: "var(--muted)" },
  tabActive: { border: "1px solid #000", color: "#000", background: "var(--subtle)", fontWeight: 600 },
  summaryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "10px" },
  summaryCard: { border: "1px solid var(--border-light)", padding: "10px", minWidth: 0 },
  netCard: { background: "var(--subtle)", borderColor: "#000" },
  label: { fontSize: "9px", color: "var(--muted)", letterSpacing: "0.04em", marginBottom: "3px" },
  summaryValue: { fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" },
  actionRow: { display: "flex", gap: "7px", marginBottom: "8px" },
  primaryBtn: { flex: 1, border: "none", background: "#000", color: "#fff", padding: "10px 8px", fontSize: "11px" },
  secondaryBtn: { background: "transparent", color: "#000", border: "1px solid #000" },
  hint: { fontSize: "10px", color: "var(--muted)", marginBottom: "18px" },
  section: { marginTop: "22px" },
  sectionLabel: { fontSize: "10px", color: "var(--muted)", letterSpacing: "0.06em", marginBottom: "7px" },
  list: { border: "1px solid var(--border-light)" },
  debtRow: { display: "flex", alignItems: "center", gap: "10px", padding: "11px", borderBottom: "1px solid var(--border-light)" },
  debtMain: { flex: 1, minWidth: 0 },
  debtTopline: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "baseline" },
  personName: { fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  amount: { fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" },
  description: { fontSize: "11px", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  direction: { fontSize: "9px", color: "var(--muted)", marginTop: "2px" },
  settleBtn: { fontSize: "10px", border: "1px solid var(--border-light)", background: "transparent", padding: "5px 7px", color: "var(--text)" },
  personRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "10px 11px", borderBottom: "1px solid var(--border-light)" },
  personAmounts: { textAlign: "right", color: "var(--muted)", fontSize: "10px", display: "flex", flexDirection: "column", gap: "1px" },
  lastRow: { borderBottom: "none" },
  empty: { color: "var(--muted)", fontSize: "12px", textAlign: "center", padding: "36px 0" },
  settledNote: { color: "var(--muted)", fontSize: "10px", marginTop: "16px", textAlign: "center" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  modal: { width: "100%", maxWidth: "480px", background: "#fff", borderTop: "1px solid #000", padding: "22px 16px 28px" },
  modalTitle: { fontSize: "13px", fontWeight: 600, marginBottom: "12px" },
  modalHint: { fontSize: "10px", color: "var(--muted)", marginBottom: "7px", lineHeight: 1.45 },
  modalLabel: { fontSize: "10px", color: "var(--muted)", margin: "11px 0 6px" },
  input: { width: "100%", border: "1px solid var(--border-light)", padding: "9px 10px", marginBottom: "8px", fontSize: "13px" },
  directionPicker: { display: "flex", gap: "5px", marginBottom: "8px" },
  directionButton: { flex: 1, border: "1px solid var(--border-light)", background: "transparent", fontSize: "10px", padding: "8px 4px", color: "var(--muted)" },
  directionActive: { borderColor: "#000", background: "var(--subtle)", color: "#000", fontWeight: 600 },
  checkRow: { display: "flex", alignItems: "center", gap: "7px", fontSize: "10px", margin: "2px 0 4px", color: "var(--muted)" },
  peoplePicker: { display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "14px" },
  personPick: { border: "1px solid var(--border-light)", padding: "5px 8px", background: "transparent", fontSize: "10px", color: "var(--muted)" },
  personPickActive: { borderColor: "#000", background: "var(--subtle)", color: "#000", fontWeight: 600 },
  modalActions: { display: "flex", gap: "8px", marginTop: "14px" },
  cancelBtn: { flex: 1, border: "1px solid var(--border-light)", background: "transparent", padding: "10px", fontSize: "11px", color: "var(--muted)" },
  confirmBtn: { flex: 2, border: "none", background: "#000", color: "#fff", padding: "10px", fontSize: "11px" },
  error: { fontSize: "10px", marginTop: "10px", color: "#c00" },
};
