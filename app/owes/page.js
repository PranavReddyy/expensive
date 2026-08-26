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
  const [splitPersonQuery, setSplitPersonQuery] = useState("");
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
  const settledDebts = debts.filter(
    (debt) => Number(debt.remaining_amount) === 0,
  );
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
      setSplitPersonQuery("");
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
      setErr(
        error.code === "23505" ? "this person already exists" : error.message,
      );
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
          <span style={s.logo}>OWES</span>
        </div>
        {profiles.length > 0 && (
          <div style={s.tabs}>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                style={{
                  ...s.tab,
                  ...(profile.id === activeId ? s.tabActive : {}),
                }}
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
              <div style={s.netCard}>
                <p style={s.label}>net</p>
                <p style={s.summaryValue}>{fmt(owedToYou - youOwe)}</p>
              </div>
            </div>

            <div style={s.actionRow}>
              <button style={s.actionBtn} onClick={() => openModal("debt")}>
                + add amount
              </button>
              <button
                style={s.actionBtn}
                onClick={() => openModal("split")}
                disabled={people.length === 0}
              >
                split payment
              </button>
              <button style={s.actionBtn} onClick={() => openModal("person")}>
                + person
              </button>
            </div>
            {people.length === 0 && (
              <p style={s.hint}>
                add a person before creating an amount or split.
              </p>
            )}

            {openDebts.length > 0 ? (
              <section style={s.section}>
                <div style={s.sectionHeader}>
                  <p style={s.sectionLabel}>open amounts</p>
                </div>
                <div style={s.list}>
                  {openDebts.map((debt) => {
                    const theyOwe = debt.direction === "they_owe_me";
                    const paid =
                      Number(debt.amount) - Number(debt.remaining_amount);
                    return (
                      <article key={debt.id} style={s.debtRow}>
                        <div style={s.debtMain}>
                          <p style={s.personName}>
                            {debt.people?.name || "unknown"}
                          </p>
                          <p style={s.description}>{debt.description}</p>
                          <p style={s.direction}>
                            {theyOwe ? "they owe you" : "you owe them"}
                            {paid > 0 && ` · ${fmt(paid)} paid`}
                          </p>
                        </div>
                        <div style={s.debtSide}>
                          <p style={s.amount}>{fmt(debt.remaining_amount)}</p>
                          <button
                            style={s.settleBtn}
                            onClick={() => openModal("payment", debt)}
                          >
                            payment
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : (
              <p style={s.empty}>no open amounts yet.</p>
            )}

            {personBalances.length > 0 && (
              <section style={s.section}>
                <div style={s.sectionHeader}>
                  <p style={s.sectionLabel}>people</p>
                </div>
                <div style={s.list}>
                  {personBalances.map(
                    ({ person, theyOwe, iOwe, net }, index) => {
                      const personStatus =
                        net > 0
                          ? `collect ${fmt(net)}`
                          : net < 0
                            ? `pay ${fmt(Math.abs(net))}`
                            : "settled";
                      return (
                        <div
                          key={person.id}
                          style={{
                            ...s.personRow,
                            ...(index === personBalances.length - 1
                              ? s.lastRow
                              : {}),
                          }}
                        >
                          <div style={s.personMain}>
                            <p style={s.personName}>{person.name}</p>
                            <p style={s.personDetail}>
                              {theyOwe > 0 && iOwe > 0
                                ? `they owe ${fmt(theyOwe)} · you owe ${fmt(iOwe)}`
                                : net === 0
                                  ? "no open amount"
                                  : net > 0
                                    ? "they owe you"
                                    : "you owe them"}
                            </p>
                          </div>
                          <span style={s.personStatus}>{personStatus}</span>
                        </div>
                      );
                    },
                  )}
                </div>
              </section>
            )}

            {settledDebts.length > 0 && (
              <p style={s.settledNote}>
                {settledDebts.length} settled amount
                {settledDebts.length === 1 ? "" : "s"} kept in history.
              </p>
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
                <ModalActions
                  onCancel={closeModal}
                  onConfirm={addPerson}
                  busy={submitting}
                  label="save person"
                />
              </>
            )}

            {modal === "debt" && (
              <>
                <p style={s.modalTitle}>add amount</p>
                <PersonSearch
                  people={people}
                  value={debtForm.person_id}
                  onChange={(personId) =>
                    setDebtForm({ ...debtForm, person_id: personId })
                  }
                />
                <div style={s.directionPicker}>
                  <button
                    style={{
                      ...s.directionButton,
                      ...(debtForm.direction === "they_owe_me"
                        ? s.directionActive
                        : {}),
                    }}
                    onClick={() =>
                      setDebtForm({ ...debtForm, direction: "they_owe_me" })
                    }
                  >
                    they owe me
                  </button>
                  <button
                    style={{
                      ...s.directionButton,
                      ...(debtForm.direction === "i_owe_them"
                        ? s.directionActive
                        : {}),
                    }}
                    onClick={() =>
                      setDebtForm({ ...debtForm, direction: "i_owe_them" })
                    }
                  >
                    i owe them
                  </button>
                </div>
                <input
                  style={s.input}
                  inputMode="decimal"
                  placeholder="amount"
                  value={debtForm.amount}
                  onChange={(event) =>
                    setDebtForm({ ...debtForm, amount: event.target.value })
                  }
                />
                <input
                  style={s.input}
                  placeholder="what was it for?"
                  value={debtForm.description}
                  onChange={(event) =>
                    setDebtForm({
                      ...debtForm,
                      description: event.target.value,
                    })
                  }
                />
                <ModalActions
                  onCancel={closeModal}
                  onConfirm={addDebt}
                  busy={submitting}
                  label="save amount"
                />
              </>
            )}

            {modal === "split" && (
              <>
                <p style={s.modalTitle}>split a payment</p>
                <p style={s.modalHint}>
                  This creates one “owes you” amount for each selected person.
                  It never changes your balance.
                </p>
                <input
                  style={s.input}
                  placeholder="what was it for?"
                  value={splitForm.description}
                  onChange={(event) =>
                    setSplitForm({
                      ...splitForm,
                      description: event.target.value,
                    })
                  }
                />
                <input
                  style={s.input}
                  inputMode="decimal"
                  placeholder="total you paid"
                  value={splitForm.amount}
                  onChange={(event) =>
                    setSplitForm({ ...splitForm, amount: event.target.value })
                  }
                />
                <label style={s.checkRow}>
                  <input
                    type="checkbox"
                    checked={splitForm.includesYou}
                    onChange={(event) =>
                      setSplitForm({
                        ...splitForm,
                        includesYou: event.target.checked,
                      })
                    }
                  />
                  <span>include my own share in the split</span>
                </label>
                <p style={s.modalLabel}>people to split with</p>
                <input
                  style={s.input}
                  placeholder="search people"
                  value={splitPersonQuery}
                  onChange={(event) => setSplitPersonQuery(event.target.value)}
                />
                <div style={s.peoplePicker}>
                  {people
                    .filter((person) =>
                      person.name
                        .toLowerCase()
                        .includes(splitPersonQuery.trim().toLowerCase()),
                    )
                    .map((person) => {
                      const checked = splitForm.people.includes(person.id);
                      return (
                        <button
                          key={person.id}
                          style={{
                            ...s.personPick,
                            ...(checked ? s.personPickActive : {}),
                          }}
                          onClick={() =>
                            setSplitForm({
                              ...splitForm,
                              people: checked
                                ? splitForm.people.filter(
                                    (id) => id !== person.id,
                                  )
                                : [...splitForm.people, person.id],
                            })
                          }
                        >
                          {checked ? "✓ " : ""}
                          {person.name}
                        </button>
                      );
                    })}
                </div>
                <ModalActions
                  onCancel={closeModal}
                  onConfirm={addSplit}
                  busy={submitting}
                  label="create split"
                />
              </>
            )}

            {modal === "payment" && selectedDebt && (
              <>
                <p style={s.modalTitle}>record payment</p>
                <p style={s.modalHint}>
                  {selectedDebt.people?.name || "person"} ·{" "}
                  {selectedDebt.direction === "they_owe_me"
                    ? "paid you"
                    : "you paid them"}
                </p>
                <p style={s.modalHint}>
                  remaining: {fmt(selectedDebt.remaining_amount)}
                </p>
                <input
                  autoFocus
                  style={s.input}
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
                <ModalActions
                  onCancel={closeModal}
                  onConfirm={recordPayment}
                  busy={submitting}
                  label="record payment"
                />
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
      <button style={s.cancelBtn} onClick={onCancel}>
        cancel
      </button>
      <button style={s.confirmBtn} onClick={onConfirm} disabled={busy}>
        {busy ? "saving..." : label}
      </button>
    </div>
  );
}

function PersonSearch({ people, value, onChange }) {
  const [query, setQuery] = useState("");
  const selected = people.find((person) => person.id === value);
  const matches = people.filter((person) =>
    person.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div style={s.personSearch}>
      <input
        autoFocus
        style={s.input}
        placeholder="search people"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (value) onChange("");
        }}
      />
      {selected && (
        <div style={s.selectedPerson}>
          <span>{selected.name}</span>
          <button
            type="button"
            style={s.clearPerson}
            onClick={() => {
              onChange("");
              setQuery("");
            }}
          >
            change
          </button>
        </div>
      )}
      {!selected && query.trim() && (
        <div style={s.searchResults}>
          {matches.length > 0 ? (
            matches.map((person) => (
              <button
                type="button"
                key={person.id}
                style={s.searchResult}
                onClick={() => {
                  onChange(person.id);
                  setQuery(person.name);
                }}
              >
                {person.name}
              </button>
            ))
          ) : (
            <p style={s.noResults}>no saved person found</p>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    paddingBottom: "calc(var(--nav-h) + 16px)",
    maxWidth: "480px",
    margin: "0 auto",
  },
  wrap: { padding: "20px 16px 8px" },
  center: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--muted)",
    fontSize: "12px",
  },
  header: { marginBottom: "20px" },
  logo: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" },
  tabs: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" },
  tab: {
    fontSize: "11px",
    padding: "5px 12px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--muted)",
  },
  tabActive: {
    border: "1px solid #000",
    color: "#000",
    background: "var(--subtle)",
    fontWeight: 600,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "6px",
    marginBottom: "10px",
  },
  summaryCard: {
    border: "1px solid var(--border-light)",
    padding: "10px",
    minWidth: 0,
  },
  netCard: {
    border: "1px solid var(--border-light)",
    padding: "10px",
    minWidth: 0,
  },
  label: {
    fontSize: "9px",
    color: "var(--muted)",
    letterSpacing: "0.04em",
    marginBottom: "3px",
  },
  summaryValue: {
    fontSize: "13px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    letterSpacing: "-0.03em",
  },
  actionRow: { display: "flex", gap: "7px", marginBottom: "8px" },
  actionBtn: {
    flex: 1,
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--text)",
    padding: "8px 4px",
    fontSize: "10px",
    whiteSpace: "nowrap",
  },
  hint: { fontSize: "10px", color: "var(--muted)", marginBottom: "18px" },
  section: { marginTop: "22px" },
  sectionHeader: { marginBottom: "7px" },
  sectionLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    letterSpacing: "0.06em",
  },
  list: { border: "1px solid var(--border-light)" },
  debtRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "11px",
    borderBottom: "1px solid var(--border-light)",
  },
  debtMain: { flex: 1, minWidth: 0 },
  debtSide: { flexShrink: 0, textAlign: "right" },
  personName: {
    fontSize: "12px",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: {
    fontSize: "11px",
    marginTop: "3px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  direction: { fontSize: "9px", color: "var(--muted)", marginTop: "2px" },
  amount: { fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" },
  settleBtn: {
    fontSize: "9px",
    border: "none",
    background: "transparent",
    padding: "2px 0",
    color: "var(--muted)",
    marginTop: "2px",
  },
  personRow: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    padding: "10px",
    borderBottom: "1px solid var(--border-light)",
  },
  personMain: { flex: 1, minWidth: 0 },
  personDetail: {
    fontSize: "9px",
    color: "var(--muted)",
    marginTop: "1px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  personStatus: {
    fontSize: "10px",
    color: "var(--muted)",
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  lastRow: { borderBottom: "none" },
  empty: {
    color: "var(--muted)",
    fontSize: "12px",
    textAlign: "center",
    padding: "36px 0",
  },
  settledNote: {
    color: "var(--muted)",
    fontSize: "10px",
    marginTop: "16px",
    textAlign: "center",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  modal: {
    width: "100%",
    maxWidth: "480px",
    background: "#fff",
    borderTop: "1px solid #000",
    padding: "22px 16px 28px",
  },
  modalTitle: { fontSize: "13px", fontWeight: 600, marginBottom: "12px" },
  modalHint: {
    fontSize: "10px",
    color: "var(--muted)",
    marginBottom: "7px",
    lineHeight: 1.45,
  },
  modalLabel: { fontSize: "10px", color: "var(--muted)", margin: "11px 0 6px" },
  input: {
    width: "100%",
    border: "1px solid var(--border-light)",
    padding: "9px 10px",
    marginBottom: "8px",
    fontSize: "13px",
  },
  personSearch: { marginBottom: "8px" },
  selectedPerson: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #000",
    padding: "8px 10px",
    fontSize: "11px",
    marginTop: "-2px",
  },
  clearPerson: {
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    fontSize: "10px",
    padding: "2px",
  },
  searchResults: {
    border: "1px solid var(--border-light)",
    borderTop: "none",
    marginTop: "-8px",
    marginBottom: "8px",
  },
  searchResult: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: "1px solid var(--border-light)",
    background: "#fff",
    padding: "8px 10px",
    fontSize: "11px",
  },
  noResults: { padding: "8px 10px", color: "var(--muted)", fontSize: "10px" },
  directionPicker: { display: "flex", gap: "5px", marginBottom: "8px" },
  directionButton: {
    flex: 1,
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "10px",
    padding: "8px 4px",
    color: "var(--muted)",
  },
  directionActive: {
    borderColor: "#000",
    background: "var(--subtle)",
    color: "#000",
    fontWeight: 600,
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    fontSize: "10px",
    margin: "2px 0 4px",
    color: "var(--muted)",
  },
  peoplePicker: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
    marginBottom: "14px",
  },
  personPick: {
    border: "1px solid var(--border-light)",
    padding: "5px 8px",
    background: "transparent",
    fontSize: "10px",
    color: "var(--muted)",
  },
  personPickActive: {
    borderColor: "#000",
    background: "var(--subtle)",
    color: "#000",
    fontWeight: 600,
  },
  modalActions: { display: "flex", gap: "8px", marginTop: "14px" },
  cancelBtn: {
    flex: 1,
    border: "1px solid var(--border-light)",
    background: "transparent",
    padding: "10px",
    fontSize: "11px",
    color: "var(--muted)",
  },
  confirmBtn: {
    flex: 2,
    border: "none",
    background: "#000",
    color: "#fff",
    padding: "10px",
    fontSize: "11px",
  },
  error: { fontSize: "10px", marginTop: "10px", color: "#c00" },
};
