"use client";
import { useState, useMemo, useRef } from "react";
import AccountSettings from "../../components/AccountSettings";
import { usePreferences } from "../../components/Preferences";
import { fmt, currencySymbol } from "../../lib/format";
import { useProfiles, useCategories, useExpenses, useDebts } from "../../lib/useAppData";
import { summarizeTabs } from "../../lib/tabs.mjs";
import DataStatus from "../../components/DataStatus";
import Link from "next/link";
import LogoutButton from "../../components/LogoutButton";
import Modal from "../../components/Modal";
import Nav from "../../components/Nav";
import AccountSwitcher from "../../components/AccountSwitcher";
import { supabase } from "../../lib/supabase";
import { queryCache } from "../../lib/query-cache.mjs";
import { homeOverview } from "../../lib/home-overview.mjs";
import { useAuth } from "../../lib/auth-context";

function getNowLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16); // → "2025-06-11T14:30"
}

export default function Dashboard() {
  usePreferences();
  const [balanceMode, setBalanceMode] = useState('set');
  const balanceRequest = useRef(null);
  const expenseRequest = useRef(null);
  const { user } = useAuth();
  const { profiles, activeId, switchProfile, loading, dataError } =
    useProfiles();

  const categories = useCategories();
  const debts = useDebts(activeId);
  const tabs = useMemo(() => summarizeTabs(debts), [debts]);
  const now = new Date();
  const monthStart = new Date(Math.min(new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime())).toISOString();
  const { data: monthExpenses, error: monthError, pending: monthPending } = useExpenses(activeId, { start: monthStart, end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() });
  const dayKey = now.toDateString();
  const overview = useMemo(() => homeOverview(monthExpenses), [monthExpenses, dayKey]);

  const [modal, setModal] = useState(null); // 'add' | 'balance' | 'profile'

  const [form, setForm] = useState({
    reason: "",
    amount: "",
    notes: "",
    category_id: "",
    datetime: getNowLocal(),
  });
  const [balanceInput, setBalanceInput] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", balance: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [transfer, setTransfer] = useState({ to: '', amount: '', id: '' });
  const [notice, setNotice] = useState('');

  const active = profiles.find((p) => p.id === activeId);

  async function transferMoney() {
    setErr('');
    if (!transfer.to || !/^\d+(\.\d{1,2})?$/.test(transfer.amount) || Number(transfer.amount) <= 0) {
      setErr('Choose an account and enter a valid amount.'); return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('transfer_money', { p_id: transfer.id, p_from: activeId, p_to: transfer.to, p_amount: Number(transfer.amount) });
      if (error) throw error;
      queryCache.invalidate(['profiles']);
      setNotice(`${fmt(transfer.amount)} transferred to ${profiles.find(p => p.id === transfer.to)?.name}`);
      setModal(null);
    } catch (e) { setErr(e.message); }
    finally { setSubmitting(false); }
  }

  // ─── Actions ─────────────────────────────────────────────────

  async function addExpense() {
    setErr("");
    const amount = Number(form.amount);
    if (!form.reason.trim()) {
      setErr("reason is required");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("enter a valid amount");
      return;
    }
    if (!form.datetime || !Number.isFinite(new Date(form.datetime).getTime())) {
      setErr("enter a valid date and time");
      return;
    }
    setSubmitting(true);

    const signature = JSON.stringify([activeId,form]);
    if (expenseRequest.current?.signature !== signature) expenseRequest.current = {signature,id:crypto.randomUUID()};
    const { error: e1 } = await supabase.rpc('ios_add_expense', {
      p_id:expenseRequest.current.id, p_profile:activeId, p_reason:form.reason.trim(),
      p_amount:amount, p_notes:form.notes.trim(), p_category:form.category_id || null,
      p_created_at:new Date(form.datetime).toISOString(),
    });
    if (e1) {
      setErr(e1.message);
      setSubmitting(false);
      return;
    }

    expenseRequest.current = null;
    queryCache.invalidate(['profiles','expenses']);

    setForm({
      reason: "",
      amount: "",
      notes: "",
      category_id: "",
      datetime: getNowLocal(),
    });
    setModal(null);
    setSubmitting(false);
  }

  async function updateBalance() {
    setErr("");
    const bal = Number(balanceInput);
    if (!/^-?\d+(\.\d{1,2})?$/.test(balanceInput) || !Number.isFinite(bal) || (balanceMode !== 'set' && bal <= 0)) {
      setErr("enter a valid amount");
      return;
    }
    setSubmitting(true);
    const signature = JSON.stringify([activeId,balanceMode,bal]);
    if (balanceRequest.current?.signature !== signature) balanceRequest.current = {signature,id:crypto.randomUUID()};
    const { error } = await supabase.rpc('adjust_balance', {p_id:balanceRequest.current.id,p_profile:activeId,p_mode:balanceMode,p_amount:bal});
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setModal(null);
    setBalanceInput("");
    balanceRequest.current = null;
    queryCache.invalidate(['profiles','account_activity']);
    setSubmitting(false);
  }

  async function createProfile() {
    setErr("");
    if (!profileForm.name.trim()) {
      setErr("name is required");
      return;
    }
    setSubmitting(true);
    const bal = Number(profileForm.balance || 0);
    if (!Number.isFinite(bal)) {
      setErr("enter a valid balance");
      setSubmitting(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .insert({ name: profileForm.name.trim(), balance: bal })
      .select()
      .single();
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setModal(null);
    setProfileForm({ name: "", balance: "" });
    setSubmitting(false);
    switchProfile(data.id);
    queryCache.invalidate(['profiles']);
  }

  function openModal(type) {
    setBalanceMode('set'); balanceRequest.current = null; expenseRequest.current = null;
    setErr("");
    setNotice('');
    if (type === 'transfer') setTransfer({ to: profiles.find(p => p.id !== activeId)?.id || '', amount: '', id: crypto.randomUUID() });
    if (type === "balance" && active) setBalanceInput(String(active.balance));
    if (type === "add")
      setForm({
        reason: "",
        amount: "",
        notes: "",
        category_id: "",
        datetime: getNowLocal(),
      });
    setModal(type);
  }

  // ─── Render ──────────────────────────────────────────────────

  if (loading || (dataError && !profiles.length))
    return <DataStatus error={dataError} />;

  return (
    <div className="home-page" style={s.page}>
      <div style={s.wrap}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.logo}>EXPENS***</span>
          <div className="home-header-actions">
            <button
              type="button"
              style={s.smallBtn}
              onClick={() => openModal("profile")}
            >
              + profile
            </button>
            <AccountSettings />
          </div>
        </div>

        {/* Profile tabs */}
        <AccountSwitcher profiles={profiles} activeId={activeId} onChange={switchProfile} />

        {profiles.length === 0 && (
          <div style={s.empty}>
            <p>no profiles yet.</p>
            <button
              type="button"
              style={s.btn}
              onClick={() => openModal("profile")}
            >
              create first profile
            </button>
          </div>
        )}

        {/* Balance card */}
        {active && (
          <div style={s.card}>
            <div style={s.cardRow}>
              <div>
                <p style={s.cardLabel}>current balance</p>
                <p
                  style={{
                    ...s.bigNum,
                    ...(active.balance < 0 ? { color: "#888" } : {}),
                  }}
                >
                  {fmt(active.balance)}
                </p>
              </div>
              <button
                type="button"
                style={s.editBtn}
                onClick={() => openModal("balance")}
              >
                edit
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
              owed to you {fmt(tabs.collect)} · you owe {fmt(tabs.pay)}
            </p>
            <p style={{ fontSize: 10, color: 'var(--muted)' }}>
              after settlement {fmt(Number(active.balance) + tabs.collect - tabs.pay)}
            </p>
            {profiles.length > 1 && <button type="button" style={{ ...s.editBtn, marginTop: 12 }} onClick={() => openModal('transfer')}>transfer money →</button>}
          </div>
        )}

        {active && (
          <button
            type="button"
            style={s.addBtn}
            onClick={() => openModal("add")}
          >
            + log expense
          </button>
        )}

        {notice && <p role="status" style={{ fontSize: 11, marginBottom: 12 }}>{notice}</p>}
        {active && (
          <section style={s.section}>
            <p style={s.sectionLabel}>spending · {now.toLocaleDateString("en-IN", { month: "long" })}</p>
            {monthError && !monthExpenses.length ? <p style={s.noData}>Could not load the spending overview.</p> : monthPending && !monthExpenses.length ? <p style={s.noData}>loading overview…</p> : <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["spent today", fmt(overview.today)], ["spent this month", fmt(overview.month)]].map(([label, value]) => (
                  <div key={label} style={{ border: "1px solid var(--border-light)", padding: 12, minWidth: 0 }}>
                    <p style={s.cardLabel}>{label}</p><p style={{ ...s.statNum, overflowWrap: "anywhere" }}>{value}</p>
                  </div>
                ))}
              </div>
              <p style={{ ...s.cardLabel, marginTop: 16 }}>last 7 days</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
                {overview.days.map((day, i) => <div key={day.key} title={`${day.label}: ${fmt(day.amount)}`} aria-label={`${day.label}: ${fmt(day.amount)}`}>
                  <div style={{ height: 54, display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ width: '100%', height: `${day.amount / Math.max(1, ...overview.days.map(d => d.amount)) * 100}%`, minHeight: day.amount ? 2 : 0, background: i === 6 ? 'var(--text)' : '#bdbdbd' }} />
                  </div><p style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: 4 }}>{day.label}</p>
                </div>)}
              </div>
              {overview.top.length > 0 && <div style={{ marginTop: 14 }}>
                <p style={s.cardLabel}>top categories this month</p>
                {overview.top.map(([name, amount]) => <div key={name} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 11, padding: '4px 0' }}>
                  <span style={{ overflowWrap: 'anywhere' }}>{name}</span><span style={{ whiteSpace: 'nowrap' }}>{fmt(amount)}</span>
                </div>)}
              </div>}
              {!overview.count && <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>No expenses this month yet.</p>}
              {monthError && monthExpenses.length > 0 && <p style={s.cardLabel}>Could not refresh. Showing saved totals.</p>}
            </>}
            <Link href="/analytics" className="home-view-all">view analytics →</Link>
          </section>
        )}
      </div>

      {/* ── Modals ── */}
      {modal && (
        <Modal
          title={
            modal === "add"
              ? "log expense"
              : modal === "balance"
                ? "edit balance"
                : modal === "transfer" ? "transfer money" : "new profile"
          }
          style={s.modal}
          overlayStyle={s.overlay}
          busy={submitting}
          onClose={() => setModal(null)}
          onSubmit={
            modal === "add"
              ? addExpense
              : modal === "balance"
                ? updateBalance
                : modal === "transfer" ? transferMoney : createProfile
          }
          onError={(error) => {
            setErr(error.message || "could not save");
            setSubmitting(false);
          }}
        >
          {modal === 'transfer' && <>
            <p style={s.modalTitle}>transfer money</p>
            <p style={{ ...s.mLabel, marginBottom: 12 }}>from {active?.name} · available {fmt(active?.balance)}</p>
            <div style={s.mField}><label htmlFor="transfer-to" style={s.mLabel}>to account</label>
              <select id="transfer-to" style={s.mInput} value={transfer.to} disabled={submitting} onChange={e => setTransfer(t => ({ ...t, to: e.target.value, id: crypto.randomUUID() }))}>
                {profiles.filter(p => p.id !== activeId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={s.mField}><label htmlFor="transfer-amount" style={s.mLabel}>amount ({currencySymbol()})</label>
              <input id="transfer-amount" style={s.mInput} inputMode="decimal" disabled={submitting} value={transfer.amount} onChange={e => setTransfer(t => ({ ...t, amount: e.target.value, id: crypto.randomUUID() }))} />
            </div>
            <p style={s.mLabel}>Moves money between these accounts. Your total money and spending stay the same.</p>
            {err && <p role="alert" style={s.mErr}>{err}</p>}
            <div style={s.mBtns}><button type="button" style={s.mCancel} disabled={submitting} onClick={() => setModal(null)}>cancel</button><button type="submit" style={s.mConfirm} disabled={submitting}>{submitting ? 'transferring…' : 'transfer'}</button></div>
          </>}
          {/* Add Expense Modal */}
          {modal === "add" && (
            <>
              <p style={s.modalTitle}>log expense</p>
              <div style={s.mField}>
                <label htmlFor="expense-reason" style={s.mLabel}>
                  reason *
                </label>
                <input
                  style={s.mInput}
                  id="expense-reason"
                  value={form.reason}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reason: e.target.value }))
                  }
                  placeholder="e.g. groceries"
                />
              </div>
              <div style={s.mField}>
                <label htmlFor="expense-amount" style={s.mLabel}>
                  amount ({currencySymbol()}) *
                </label>
                <input
                  style={s.mInput}
                  type="text"
                  inputMode="decimal"
                  id="expense-amount"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>

              <div style={s.mField}>
                <label htmlFor="expense-datetime" style={s.mLabel}>
                  date & time
                </label>
                <input
                  style={s.mInput}
                  type="datetime-local"
                  id="expense-datetime"
                  value={form.datetime}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, datetime: e.target.value }))
                  }
                />
              </div>

              {/* Category picker — name only, no icon */}
              {categories.length > 0 && (
                <div style={s.mField}>
                  <label style={s.mLabel}>category</label>
                  <div style={s.catGrid}>
                    {categories.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        style={{
                          ...s.catBtn,
                          ...(form.category_id === c.id ? s.catBtnActive : {}),
                        }}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            category_id: f.category_id === c.id ? "" : c.id,
                          }))
                        }
                      >
                        <span style={{ fontSize: "11px" }}>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={s.mField}>
                <label htmlFor="expense-notes" style={s.mLabel}>
                  notes
                </label>
                <textarea
                  style={{ ...s.mInput, height: "60px", resize: "none" }}
                  id="expense-notes"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="optional"
                />
              </div>
              {err && <p style={s.mErr}>// {err}</p>}
              <div style={s.mBtns}>
                <button
                  type="button"
                  disabled={submitting}
                  style={s.mCancel}
                  onClick={() => setModal(null)}
                >
                  cancel
                </button>
                <button style={s.mConfirm} type="submit" disabled={submitting}>
                  {submitting ? "saving..." : "save"}
                </button>
              </div>
            </>
          )}

          {/* Edit Balance Modal */}
          {modal === "balance" && (
            <>
              <p style={s.modalTitle}>edit balance — {active?.name}</p>
              <div className="segmented" style={{marginBottom:16}}>{['set','add','subtract'].map(mode => <button type="button" key={mode} aria-pressed={balanceMode === mode} onClick={() => {setBalanceMode(mode);setBalanceInput(mode === 'set' ? String(active.balance) : '');}}>{mode}</button>)}</div>
              <div style={s.mField}>
                <label htmlFor="balance-input" style={s.mLabel}>
                  {balanceMode === 'set' ? 'current money in this account' : `amount to ${balanceMode}`}
                </label>
                <input
                  style={s.mInput}
                  type="text"
                  inputMode="decimal"
                  id="balance-input"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                />
                <p style={s.mLabel}>{balanceMode === 'set' ? 'Enter what you have now. Open tabs are not added or deducted again.' : 'Enter only the adjustment, not your new total. This is not recorded as spending.'}</p>
              </div>
              {err && <p style={s.mErr}>// {err}</p>}
              <div style={s.mBtns}>
                <button
                  type="button"
                  disabled={submitting}
                  style={s.mCancel}
                  onClick={() => setModal(null)}
                >
                  cancel
                </button>
                <button style={s.mConfirm} type="submit" disabled={submitting}>
                  {submitting ? "saving..." : "update"}
                </button>
              </div>
            </>
          )}

          {/* New Profile Modal */}
          {modal === "profile" && (
            <>
              <p style={s.modalTitle}>new profile</p>
              <div style={s.mField}>
                <label htmlFor="profile-name" style={s.mLabel}>
                  name *
                </label>
                <input
                  style={s.mInput}
                  id="profile-name"
                  value={profileForm.name}
                  onChange={(e) =>
                    setProfileForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. personal"
                />
              </div>
              <div style={s.mField}>
                <label htmlFor="profile-balance" style={s.mLabel}>
                  starting balance ({currencySymbol()})
                </label>
                <input
                  style={s.mInput}
                  type="text"
                  inputMode="decimal"
                  id="profile-balance"
                  value={profileForm.balance}
                  onChange={(e) =>
                    setProfileForm((f) => ({ ...f, balance: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
              {err && <p style={s.mErr}>// {err}</p>}
              <div style={s.mBtns}>
                <button
                  type="button"
                  disabled={submitting}
                  style={s.mCancel}
                  onClick={() => setModal(null)}
                >
                  cancel
                </button>
                <button style={s.mConfirm} type="submit" disabled={submitting}>
                  {submitting ? "creating..." : "create"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      <Nav />
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
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  logo: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" },
  smallBtn: {
    fontSize: "11px",
    background: "transparent",
    border: "1px solid var(--text)",
    padding: "4px 10px",
    color: "var(--text)",
    cursor: "pointer",
  },

  tabs: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" },
  tab: {
    fontSize: "11px",
    padding: "5px 12px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
  },
  tabActive: {
    border: "1px solid var(--text)",
    color: "var(--text)",
    background: "var(--subtle)",
    fontWeight: 600,
  },

  card: { border: "1px solid var(--text)", padding: "16px", marginBottom: "16px" },
  cardRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    marginBottom: "4px",
    letterSpacing: "0.04em",
  },
  bigNum: {
    fontSize: "26px",
    fontWeight: 500,
    letterSpacing: "-0.02em",
    lineHeight: 1,
  },
  editBtn: {
    fontSize: "11px",
    background: "transparent",
    border: "1px solid var(--border-light)",
    padding: "4px 10px",
    color: "var(--muted)",
    cursor: "pointer",
    marginTop: "4px",
  },
  divider: { borderTop: "1px solid var(--border-light)", margin: "14px 0" },
  statsRow: { display: "flex", justifyContent: "space-between" },
  statNum: { fontSize: "14px", fontWeight: 500 },

  addBtn: {
    width: "100%",
    padding: "13px",
    background: "var(--text)",
    color: "var(--bg)",
    border: "none",
    fontSize: "13px",
    textAlign: "left",
    letterSpacing: "0.02em",
    marginBottom: "24px",
    cursor: "pointer",
  },

  section: { marginBottom: "24px" },
  sectionLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    letterSpacing: "0.06em",
    marginBottom: "8px",
  },
  list: { border: "1px solid var(--border-light)" },
  expRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border-light)",
  },
  expLeft: { flex: 1, minWidth: 0, paddingRight: "12px" },
  expReason: { fontSize: "13px", fontWeight: 500 },
  catTag: {
    fontSize: "9px",
    padding: "2px 6px",
    border: "1px solid var(--border-light)",
    color: "var(--muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  expNotes: {
    fontSize: "11px",
    color: "var(--muted)",
    marginBottom: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  expDate: { fontSize: "10px", color: "var(--muted)", marginTop: "2px" },
  expAmount: { fontSize: "13px", fontWeight: 500, whiteSpace: "nowrap" },

  noData: {
    fontSize: "12px",
    color: "var(--muted)",
    textAlign: "center",
    padding: "32px 0",
  },
  empty: {
    textAlign: "center",
    padding: "40px 0",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    alignItems: "center",
  },
  btn: {
    padding: "10px 20px",
    background: "var(--text)",
    color: "var(--bg)",
    border: "none",
    fontSize: "13px",
    cursor: "pointer",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 200,
  },
  modal: {
    background: "var(--bg)",
    width: "100%",
    maxWidth: "480px",
    padding: "24px 20px 32px",
    borderTop: "1px solid var(--text)",
  },
  modalTitle: {
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: "20px",
    letterSpacing: "0.02em",
  },
  mField: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "14px",
  },
  mLabel: { fontSize: "11px", color: "var(--muted)" },
  mInput: {
    padding: "9px 11px",
    border: "1px solid var(--border-light)",
    fontSize: "13px",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  },
  mErr: {
    fontSize: "11px",
    background: "var(--subtle)",
    padding: "7px 10px",
    marginBottom: "12px",
    borderLeft: "2px solid var(--text)",
  },
  mBtns: { display: "flex", gap: "8px", marginTop: "4px" },
  mCancel: {
    flex: 1,
    padding: "10px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "13px",
    color: "var(--muted)",
    cursor: "pointer",
  },
  mConfirm: {
    flex: 1,
    padding: "10px",
    border: "none",
    background: "var(--text)",
    color: "var(--bg)",
    fontSize: "13px",
    cursor: "pointer",
  },

  catGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "6px",
  },
  catBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 6px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    cursor: "pointer",
  },
  catBtnActive: {
    border: "1px solid var(--text)",
    background: "var(--subtle)",
    fontWeight: 600,
  },
};
