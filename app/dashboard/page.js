"use client";
import { useState, useMemo } from "react";
import { fmt, fmtExpenseDate } from "../../lib/format";
import { useProfiles, useCategories, useExpenses } from "../../lib/useAppData";
import DataStatus from "../../components/DataStatus";
import Link from "next/link";
import LogoutButton from "../../components/LogoutButton";
import RecentExpenses from "../../components/RecentExpenses";
import Modal from "../../components/Modal";
import Nav from "../../components/Nav";
import { supabase } from "../../lib/supabase";

function getNowLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16); // → "2025-06-11T14:30"
}

export default function Dashboard() {
  const { profiles, activeId, switchProfile, loading, dataError } = useProfiles();

  const categories = useCategories();
  const { data: expenses } = useExpenses(activeId, { limit: 6 });
  const { data: amounts } = useExpenses(activeId, { amountsOnly: true });
  const totalSpent = useMemo(() => amounts.reduce((sum, expense) => sum + Number(expense.amount), 0), [amounts]);

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

  const active = profiles.find((p) => p.id === activeId);

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

    const { error: e1 } = await supabase.from("expenses").insert({
      profile_id: activeId,
      reason: form.reason.trim(),
      amount,
      notes: form.notes.trim() || null,
      category_id: form.category_id || null,
      created_at: new Date(form.datetime).toISOString(),
    });
    if (e1) {
      setErr(e1.message);
      setSubmitting(false);
      return;
    }

    const { error: e2 } = await supabase
      .from("profiles")
      .update({ balance: (active?.balance || 0) - amount })
      .eq("id", activeId);
    if (e2) {
      setErr(e2.message);
      setSubmitting(false);
      return;
    }

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
    if (!balanceInput.trim() || !Number.isFinite(bal)) {
      setErr("enter a valid amount");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("profiles")
      .update({ balance: bal })
      .eq("id", activeId);
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    setModal(null);
    setBalanceInput("");
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
    if (!Number.isFinite(bal)) { setErr("enter a valid balance"); setSubmitting(false); return; }
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
  }

  function openModal(type) {
    setErr("");
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

  const expenseRows = useMemo(() => expenses.map((e) => (
                <div key={e.id} style={s.expRow}>
                  <div style={s.expLeft}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "2px",
                      }}
                    >
                      <p style={s.expReason}>{e.reason}</p>
                      {e.categories && (
                        <span style={s.catTag}>{e.categories.name}</span>
                      )}
                    </div>
                    {e.notes && <p style={s.expNotes}>{e.notes}</p>}
                    <p style={s.expDate}>
                      {fmtExpenseDate(e.created_at)}
                    </p>
                  </div>
                  <p style={s.expAmount}>{fmt(e.amount)}</p>
                </div>
              )), [expenses]);

  if (loading || (dataError && !profiles.length)) return <DataStatus error={dataError} />;

  return (
    <div className="home-page" style={s.page}>
      <div style={s.wrap}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.logo}>EXPENSIVE</span>
          <div className="home-header-actions">
            <button type="button" style={s.smallBtn} onClick={() => openModal("profile")}>
              + profile
            </button>
            <LogoutButton style={s.smallBtn} />
          </div>
        </div>

        {/* Profile tabs */}
        {profiles.length > 0 && (
          <div style={s.tabs}>
            {profiles.map((p) => (
              <button type="button"
                key={p.id}
                style={{ ...s.tab, ...(p.id === activeId ? s.tabActive : {}) }}
                onClick={() => switchProfile(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {profiles.length === 0 && (
          <div style={s.empty}>
            <p>no profiles yet.</p>
            <button type="button" style={s.btn} onClick={() => openModal("profile")}>
              create first profile
            </button>
          </div>
        )}

        {/* Balance card */}
        {active && (
          <div style={s.card}>
            <div style={s.cardRow}>
              <div>
                <p style={s.cardLabel}>balance</p>
                <p
                  style={{
                    ...s.bigNum,
                    ...(active.balance < 0 ? { color: "#888" } : {}),
                  }}
                >
                  {fmt(active.balance)}
                </p>
              </div>
              <button type="button" style={s.editBtn} onClick={() => openModal("balance")}>
                edit
              </button>
            </div>
            <div style={s.divider} />
            <div style={s.statsRow}>
              <div>
                <p style={s.cardLabel}>total logged</p>
                <p style={s.statNum}>{fmt(totalSpent)}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={s.cardLabel}>profile</p>
                <p style={s.statNum}>{active.name}</p>
              </div>
            </div>
          </div>
        )}

        {active && (
          <button type="button" style={s.addBtn} onClick={() => openModal("add")}>
            + log expense
          </button>
        )}

        {/* Recent expenses */}
        {active && expenses.length > 0 && (
          <div className="home-recent" style={s.section}>
            <p style={s.sectionLabel}>recent</p>
            <RecentExpenses style={s.list}>{expenseRows}</RecentExpenses>
            <Link href="/expenses" className="home-view-all">all expenses →</Link>
          </div>
        )}

        {active && expenses.length === 0 && (
          <p style={s.noData}>no expenses logged yet.</p>
        )}
      </div>

      {/* ── Modals ── */}
      {modal && (
        <Modal title={modal === "add" ? "log expense" : modal === "balance" ? "edit balance" : "new profile"}
          style={s.modal} overlayStyle={s.overlay} busy={submitting}
          onClose={() => setModal(null)}
          onSubmit={modal === "add" ? addExpense : modal === "balance" ? updateBalance : createProfile}
          onError={(error) => { setErr(error.message || "could not save"); setSubmitting(false); }}>
            {/* Add Expense Modal */}
            {modal === "add" && (
              <>
                <p style={s.modalTitle}>log expense</p>
                <div style={s.mField}>
                  <label htmlFor="expense-reason" style={s.mLabel}>reason *</label>
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
                  <label htmlFor="expense-amount" style={s.mLabel}>amount (₹) *</label>
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
                  <label htmlFor="expense-datetime" style={s.mLabel}>date & time</label>
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
                        <button type="button"
                          key={c.id}
                          style={{
                            ...s.catBtn,
                            ...(form.category_id === c.id
                              ? s.catBtnActive
                              : {}),
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
                  <label htmlFor="expense-notes" style={s.mLabel}>notes</label>
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
                  <button type="button" disabled={submitting} style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? "saving..." : "save"}
                  </button>
                </div>
              </>
            )}

            {/* Edit Balance Modal */}
            {modal === "balance" && (
              <>
                <p style={s.modalTitle}>edit balance — {active?.name}</p>
                <div style={s.mField}>
                  <label htmlFor="balance-input" style={s.mLabel}>new balance (₹)</label>
                  <input
                    style={s.mInput}
                    type="text"
                    inputMode="decimal"
                    id="balance-input"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                  />
                </div>
                {err && <p style={s.mErr}>// {err}</p>}
                <div style={s.mBtns}>
                  <button type="button" disabled={submitting} style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    type="submit"
                    disabled={submitting}
                  >
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
                  <label htmlFor="profile-name" style={s.mLabel}>name *</label>
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
                  <label htmlFor="profile-balance" style={s.mLabel}>starting balance (₹)</label>
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
                  <button type="button" disabled={submitting} style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    type="submit"
                    disabled={submitting}
                  >
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
    border: "1px solid #000",
    padding: "4px 10px",
    color: "#000",
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
    border: "1px solid #000",
    color: "#000",
    background: "var(--subtle)",
    fontWeight: 600,
  },

  card: { border: "1px solid #000", padding: "16px", marginBottom: "16px" },
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
    background: "#000",
    color: "#fff",
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
    background: "#000",
    color: "#fff",
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
    background: "#fff",
    width: "100%",
    maxWidth: "480px",
    padding: "24px 20px 32px",
    borderTop: "1px solid #000",
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
    borderLeft: "2px solid #000",
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
    background: "#000",
    color: "#fff",
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
    border: "1px solid #000",
    background: "var(--subtle)",
    fontWeight: 600,
  },
};
