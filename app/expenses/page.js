"use client";
import { useState, useEffect, useCallback } from "react";
import Nav from "../../components/Nav";
import { supabase } from "../../lib/supabase";

const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function getRange(filter) {
  const now = new Date();
  const start = new Date();

  if (filter === "day") {
    start.setHours(0, 0, 0, 0);
  } else if (filter === "week") {
    const day = now.getDay();
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);
  } else if (filter === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (filter === "year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }

  return filter === "all" ? null : start.toISOString();
}

export default function ExpensesPage() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);

  // Transfer modal
  const [transferExpense, setTransferExpense] = useState(null);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [tErr, setTErr] = useState("");

  const active = profiles.find((p) => p.id === activeId);
  const otherProfiles = profiles.filter((p) => p.id !== activeId);
  const totalFiltered = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);

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
    if (validId) setActiveId(validId);
    setLoading(false);
  }, []);

  const loadExpenses = useCallback(async (profileId, f) => {
    if (!profileId) return;
    const from = getRange(f);

    let q = supabase
      .from("expenses")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (from) q = q.gte("created_at", from);

    const { data } = await q;
    setExpenses(data || []);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (activeId) loadExpenses(activeId, filter);
  }, [activeId, filter, loadExpenses]);

  // Realtime
  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`exp-page-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `profile_id=eq.${activeId}`,
        },
        () => loadExpenses(activeId, filter),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId, filter, loadExpenses]);

  useEffect(() => {
    const ch = supabase
      .channel("exp-profiles-rt")
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

  function switchProfile(id) {
    setActiveId(id);
    if (typeof window !== "undefined")
      localStorage.setItem("activeProfileId", id);
  }

  async function handleTransfer() {
    if (!transferTargetId || !transferExpense) {
      setTErr("select a profile");
      return;
    }
    setTransferring(true);
    setTErr("");

    const target = profiles.find((p) => p.id === transferTargetId);
    if (!target) {
      setTErr("profile not found");
      setTransferring(false);
      return;
    }

    // 1. Update expense profile_id
    const { error: e1 } = await supabase
      .from("expenses")
      .update({ profile_id: transferTargetId })
      .eq("id", transferExpense.id);
    if (e1) {
      setTErr(e1.message);
      setTransferring(false);
      return;
    }

    // 2. Return money to source profile
    const { error: e2 } = await supabase
      .from("profiles")
      .update({
        balance: (active?.balance || 0) + parseFloat(transferExpense.amount),
      })
      .eq("id", activeId);
    if (e2) {
      setTErr(e2.message);
      setTransferring(false);
      return;
    }

    // 3. Deduct from target profile
    const { error: e3 } = await supabase
      .from("profiles")
      .update({
        balance: (target.balance || 0) - parseFloat(transferExpense.amount),
      })
      .eq("id", transferTargetId);
    if (e3) {
      setTErr(e3.message);
      setTransferring(false);
      return;
    }

    setTransferExpense(null);
    setTransferTargetId("");
    setTransferring(false);
    loadProfiles();
    loadExpenses(activeId, filter);
  }

  async function deleteExpense(exp) {
    if (!confirm(`delete "${exp.reason}"?`)) return;

    // Restore balance
    await supabase
      .from("profiles")
      .update({ balance: (active?.balance || 0) + parseFloat(exp.amount) })
      .eq("id", activeId);

    await supabase.from("expenses").delete().eq("id", exp.id);

    loadProfiles();
    loadExpenses(activeId, filter);
  }

  const filters = ["day", "week", "month", "year", "all"];

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
          <span style={s.logo}>EXPENSES</span>
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

        {/* Filter bar */}
        <div style={s.filterBar}>
          {filters.map((f) => (
            <button
              key={f}
              style={{
                ...s.filterBtn,
                ...(filter === f ? s.filterActive : {}),
              }}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Summary */}
        {expenses.length > 0 && (
          <div style={s.summary}>
            <span style={s.summaryLabel}>
              {expenses.length} expense{expenses.length !== 1 ? "s" : ""}
            </span>
            <span style={s.summaryTotal}>{fmt(totalFiltered)}</span>
          </div>
        )}

        {/* Expense list */}
        {expenses.length > 0 ? (
          <div style={s.list}>
            {expenses.map((e, i) => (
              <div
                key={e.id}
                style={{
                  ...s.row,
                  ...(i === expenses.length - 1
                    ? { borderBottom: "none" }
                    : {}),
                }}
              >
                <div style={s.rowMain}>
                  <div style={s.rowLeft}>
                    <p style={s.reason}>{e.reason}</p>
                    {e.notes && <p style={s.notes}>{e.notes}</p>}
                    <p style={s.date}>
                      {new Date(e.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p style={s.amount}>{fmt(e.amount)}</p>
                </div>
                <div style={s.rowActions}>
                  {otherProfiles.length > 0 && (
                    <button
                      style={s.actionBtn}
                      onClick={() => {
                        setTransferExpense(e);
                        setTransferTargetId("");
                        setTErr("");
                      }}
                    >
                      transfer
                    </button>
                  )}
                  <button
                    style={{ ...s.actionBtn, color: "var(--muted)" }}
                    onClick={() => deleteExpense(e)}
                  >
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={s.empty}>no expenses for this period.</p>
        )}
      </div>

      {/* Transfer Modal */}
      {transferExpense && (
        <div style={s.overlay} onClick={() => setTransferExpense(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <p style={s.modalTitle}>transfer expense</p>
            <div style={s.transferInfo}>
              <p style={s.reason}>{transferExpense.reason}</p>
              <p
                style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
              >
                {fmt(transferExpense.amount)}
              </p>
            </div>
            <p style={s.mLabel}>move to profile</p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                margin: "10px 0 16px",
              }}
            >
              {otherProfiles.map((p) => (
                <button
                  key={p.id}
                  style={{
                    ...s.profileOption,
                    ...(transferTargetId === p.id ? s.profileOptionActive : {}),
                  }}
                  onClick={() => setTransferTargetId(p.id)}
                >
                  <span>{p.name}</span>
                  <span style={{ color: "var(--muted)", fontSize: "11px" }}>
                    {fmt(p.balance)}
                  </span>
                </button>
              ))}
            </div>
            {tErr && <p style={s.mErr}>// {tErr}</p>}
            <div style={s.mBtns}>
              <button
                style={s.mCancel}
                onClick={() => setTransferExpense(null)}
              >
                cancel
              </button>
              <button
                style={s.mConfirm}
                onClick={handleTransfer}
                disabled={transferring || !transferTargetId}
              >
                {transferring ? "transferring..." : "confirm transfer"}
              </button>
            </div>
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

  header: { marginBottom: "20px" },
  logo: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" },

  tabs: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" },
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

  filterBar: { display: "flex", gap: "4px", marginBottom: "16px" },
  filterBtn: {
    padding: "5px 10px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "11px",
    color: "var(--muted)",
  },
  filterActive: {
    border: "1px solid #000",
    color: "#000",
    background: "var(--subtle)",
    fontWeight: 600,
  },

  summary: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid var(--border-light)",
    marginBottom: "8px",
  },
  summaryLabel: { fontSize: "11px", color: "var(--muted)" },
  summaryTotal: { fontSize: "15px", fontWeight: 600 },

  list: { border: "1px solid var(--border-light)" },
  row: { padding: "12px", borderBottom: "1px solid var(--border-light)" },
  rowMain: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "8px",
  },
  rowLeft: { flex: 1, minWidth: 0, paddingRight: "12px" },
  reason: { fontSize: "13px", fontWeight: 500, marginBottom: "2px" },
  notes: { fontSize: "11px", color: "var(--muted)", marginBottom: "2px" },
  date: { fontSize: "10px", color: "var(--muted)" },
  amount: { fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" },
  rowActions: { display: "flex", gap: "8px" },
  actionBtn: {
    fontSize: "10px",
    padding: "4px 10px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--text)",
    letterSpacing: "0.02em",
  },

  empty: {
    fontSize: "12px",
    color: "var(--muted)",
    textAlign: "center",
    padding: "40px 0",
  },

  // Modal
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
  modalTitle: { fontSize: "13px", fontWeight: 600, marginBottom: "16px" },
  transferInfo: {
    background: "var(--subtle)",
    padding: "12px",
    marginBottom: "16px",
    borderLeft: "2px solid #000",
  },
  mLabel: { fontSize: "11px", color: "var(--muted)" },
  profileOption: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "13px",
    width: "100%",
    textAlign: "left",
  },
  profileOptionActive: {
    border: "1px solid #000",
    background: "var(--subtle)",
    fontWeight: 600,
  },
  mErr: {
    fontSize: "11px",
    background: "var(--subtle)",
    padding: "7px 10px",
    marginBottom: "12px",
    borderLeft: "2px solid #000",
  },
  mBtns: { display: "flex", gap: "8px", marginTop: "8px" },
  mCancel: {
    flex: 1,
    padding: "10px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "13px",
    color: "var(--muted)",
  },
  mConfirm: {
    flex: 2,
    padding: "10px",
    border: "none",
    background: "#000",
    color: "#fff",
    fontSize: "13px",
  },
};
