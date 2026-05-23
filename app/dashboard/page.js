"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Nav from "../../components/Nav";
import { supabase } from "../../lib/supabase";

const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Dashboard() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null); // 'add' | 'balance' | 'profile'

  const [form, setForm] = useState({
    reason: "",
    amount: "",
    notes: "",
    category_id: "",
  });
  const [balanceInput, setBalanceInput] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", balance: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const active = profiles.find((p) => p.id === activeId);

  // ─── Data loading ────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    const { data } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order", { ascending: true });
    setCategories(data || []);
  }, []);

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
      saved && data.find((p) => p.id === saved) ? saved : data[0]?.id;
    if (validId) {
      setActiveId(validId);
      if (typeof window !== "undefined")
        localStorage.setItem("activeProfileId", validId);
    }
    setLoading(false);
  }, []);

  // No icon column in schema — select only id and name
  const loadExpenses = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("expenses")
      .select("*, categories(id, name)")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(6);
    setExpenses(data || []);
  }, []);

  const loadTotalSpent = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("expenses")
      .select("amount")
      .eq("profile_id", profileId);
    const total = (data || []).reduce((s, e) => s + parseFloat(e.amount), 0);
    setTotalSpent(total);
  }, []);

  // Add at the top of the component
  const firstInputRef = useRef(null);

  // Add this effect — fires when modal opens
  useEffect(() => {
    if (!modal) return;
    const t = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 80); // small delay lets the modal render into the DOM
    return () => clearTimeout(t);
  }, [modal]);

  useEffect(() => {
    loadCategories();
    loadProfiles();
  }, [loadCategories, loadProfiles]);

  useEffect(() => {
    if (activeId) {
      loadExpenses(activeId);
      loadTotalSpent(activeId);
    }
  }, [activeId, loadExpenses, loadTotalSpent]);

  // ─── Realtime ────────────────────────────────────────────────

  useEffect(() => {
    const ch = supabase
      .channel("rt-profiles")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        loadProfiles,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`rt-expenses-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `profile_id=eq.${activeId}`,
        },
        () => {
          loadExpenses(activeId);
          loadTotalSpent(activeId);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId, loadExpenses, loadTotalSpent]);

  useEffect(() => {
    const ch = supabase
      .channel("rt-categories")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        loadCategories,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadCategories]);

  // ─── Actions ─────────────────────────────────────────────────

  function switchProfile(id) {
    setActiveId(id);
    if (typeof window !== "undefined")
      localStorage.setItem("activeProfileId", id);
  }

  async function addExpense() {
    setErr("");
    const amount = parseFloat(form.amount);
    if (!form.reason.trim()) {
      setErr("reason is required");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setErr("enter a valid amount");
      return;
    }
    setSubmitting(true);

    const { error: e1 } = await supabase.from("expenses").insert({
      profile_id: activeId,
      reason: form.reason.trim(),
      amount,
      notes: form.notes.trim() || null,
      category_id: form.category_id || null,
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

    setForm({ reason: "", amount: "", notes: "", category_id: "" });
    setModal(null);
    setSubmitting(false);
    loadProfiles();
    loadExpenses(activeId);
    loadTotalSpent(activeId);
  }

  async function updateBalance() {
    setErr("");
    const bal = parseFloat(balanceInput);
    if (isNaN(bal)) {
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
    loadProfiles();
  }

  async function createProfile() {
    setErr("");
    if (!profileForm.name.trim()) {
      setErr("name is required");
      return;
    }
    setSubmitting(true);
    const bal = parseFloat(profileForm.balance) || 0;
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
    loadProfiles();
  }

  function openModal(type) {
    setErr("");
    if (type === "balance" && active) setBalanceInput(String(active.balance));
    if (type === "add")
      setForm({ reason: "", amount: "", notes: "", category_id: "" });
    setModal(type);
  }

  // ─── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.center}>
        <p style={{ color: "var(--muted)", fontSize: "12px" }}>loading...</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.logo}>EXPENSIVE</span>
          <button style={s.smallBtn} onClick={() => openModal("profile")}>
            + profile
          </button>
        </div>

        {/* Profile tabs */}
        {profiles.length > 0 && (
          <div style={s.tabs}>
            {profiles.map((p) => (
              <button
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
            <button style={s.btn} onClick={() => openModal("profile")}>
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
              <button style={s.editBtn} onClick={() => openModal("balance")}>
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
          <button style={s.addBtn} onClick={() => openModal("add")}>
            + log expense
          </button>
        )}

        {/* Recent expenses */}
        {active && expenses.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>recent</p>
            <div style={s.list}>
              {expenses.map((e) => (
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
                      {new Date(e.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p style={s.expAmount}>{fmt(e.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {active && expenses.length === 0 && (
          <p style={s.noData}>no expenses logged yet.</p>
        )}
      </div>

      {/* ── Modals ── */}
      {modal && (
        <div style={s.overlay} onClick={() => setModal(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            {/* Add Expense Modal */}
            {modal === "add" && (
              <>
                <p style={s.modalTitle}>log expense</p>
                <div style={s.mField}>
                  <label style={s.mLabel}>reason *</label>
                  <input
                    ref={firstInputRef}
                    style={s.mInput}
                    value={form.reason}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, reason: e.target.value }))
                    }
                    placeholder="e.g. groceries"
                  />
                </div>
                <div style={s.mField}>
                  <label style={s.mLabel}>amount (₹) *</label>
                  <input
                    style={s.mInput}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>

                {/* Category picker — name only, no icon */}
                {categories.length > 0 && (
                  <div style={s.mField}>
                    <label style={s.mLabel}>category</label>
                    <div style={s.catGrid}>
                      {categories.map((c) => (
                        <button
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
                  <label style={s.mLabel}>notes</label>
                  <textarea
                    style={{ ...s.mInput, height: "60px", resize: "none" }}
                    value={form.notes}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    placeholder="optional"
                  />
                </div>
                {err && <p style={s.mErr}>// {err}</p>}
                <div style={s.mBtns}>
                  <button style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    onClick={addExpense}
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
                  <label style={s.mLabel}>new balance (₹)</label>
                  <input
                    ref={firstInputRef}
                    style={s.mInput}
                    type="number"
                    step="0.01"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                  />
                </div>
                {err && <p style={s.mErr}>// {err}</p>}
                <div style={s.mBtns}>
                  <button style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    onClick={updateBalance}
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
                  <label style={s.mLabel}>name *</label>
                  <input
                    ref={firstInputRef}
                    style={s.mInput}
                    value={profileForm.name}
                    onChange={(e) =>
                      setProfileForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. personal"
                  />
                </div>
                <div style={s.mField}>
                  <label style={s.mLabel}>starting balance (₹)</label>
                  <input
                    style={s.mInput}
                    type="number"
                    step="0.01"
                    value={profileForm.balance}
                    onChange={(e) =>
                      setProfileForm((f) => ({ ...f, balance: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>
                {err && <p style={s.mErr}>// {err}</p>}
                <div style={s.mBtns}>
                  <button style={s.mCancel} onClick={() => setModal(null)}>
                    cancel
                  </button>
                  <button
                    style={s.mConfirm}
                    onClick={createProfile}
                    disabled={submitting}
                  >
                    {submitting ? "creating..." : "create"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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
