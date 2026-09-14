"use client";
import { useState, useMemo, useCallback } from "react";
import { fmt, fmtFullExpenseDate } from "../../lib/format";
import { useProfiles, useCategories, useExpenses, usePageState } from "../../lib/useAppData";
import DataStatus from "../../components/DataStatus";
import Modal from "../../components/Modal";
import Nav from "../../components/Nav";
import { supabase } from "../../lib/supabase";

function getPeriodRange(filter, periodDate = new Date()) {
  if (filter === "all") return null;

  const start = new Date(periodDate);
  start.setHours(0, 0, 0, 0);
  if (filter === "week") start.setDate(start.getDate() - start.getDay());
  if (filter === "month") start.setDate(1);
  if (filter === "year") start.setMonth(0, 1);

  const end = new Date(start);
  if (filter === "day") end.setDate(end.getDate() + 1);
  if (filter === "week") end.setDate(end.getDate() + 7);
  if (filter === "month") end.setMonth(end.getMonth() + 1);
  if (filter === "year") end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function shiftPeriod(periodDate, filter, amount) {
  const next = new Date(periodDate);
  if (filter === "day") next.setDate(next.getDate() + amount);
  if (filter === "week") next.setDate(next.getDate() + amount * 7);
  if (filter === "month") {
    next.setDate(1);
    next.setMonth(next.getMonth() + amount);
  }
  if (filter === "year") {
    next.setMonth(0, 1);
    next.setFullYear(next.getFullYear() + amount);
  }
  return next;
}

function isCurrentPeriod(periodDate, filter) {
  if (filter === "all") return true;
  return (
    getPeriodRange(filter, periodDate).start.getTime() >=
    getPeriodRange(filter).start.getTime()
  );
}

function formatPeriod(periodDate, filter) {
  if (filter === "all") return "All expenses";
  const { start, end } = getPeriodRange(filter, periodDate);
  if (filter === "day") {
    return start.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (filter === "week") {
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    return `${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${lastDay.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (filter === "month") {
    return start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  return String(start.getFullYear());
}

export default function ExpensesPage() {
  const { profiles, activeId, switchProfile, loading, dataError } = useProfiles();
  const [filter, setFilter] = usePageState("expenses:filter", "month");
  const [periodDate, setPeriodDate] = usePageState("expenses:periodDate", () => new Date());
  const [categoryFilter, setCategoryFilter] = usePageState("expenses:categoryFilter", "all");

  const [transferExpense, setTransferExpense] = useState(null);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [tErr, setTErr] = useState("");

  const categories = useCategories();
  const range = getPeriodRange(filter, periodDate);
  const { data: expenses } = useExpenses(activeId, {
    start: range?.start.toISOString(), end: range?.end.toISOString(),
  });

  const active = profiles.find((p) => p.id === activeId);
  const otherProfiles = useMemo(() => profiles.filter((p) => p.id !== activeId), [profiles, activeId]);

  const visibleExpenses = useMemo(() =>
    categoryFilter === "all" ? expenses : expenses.filter((e) => e.category_id === categoryFilter),
    [expenses, categoryFilter],
  );
  const totalFiltered = useMemo(() =>
    visibleExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0),
    [visibleExpenses],
  );
  const activeCategories = useMemo(() => {
    const ids = new Set(expenses.map((e) => e.category_id));
    return categories.filter((category) => ids.has(category.id));
  }, [categories, expenses]);

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

    const { error: e1 } = await supabase
      .from("expenses")
      .update({ profile_id: transferTargetId })
      .eq("id", transferExpense.id);
    if (e1) {
      setTErr(e1.message);
      setTransferring(false);
      return;
    }

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
  }

  const deleteExpense = useCallback(async (exp) => {
    if (!confirm(`delete "${exp.reason}"?`)) return;
    await supabase
      .from("profiles")
      .update({ balance: (active?.balance || 0) + parseFloat(exp.amount) })
      .eq("id", activeId);
    await supabase.from("expenses").delete().eq("id", exp.id);
  }, [active, activeId, filter, periodDate]);

  const timeFilters = ["day", "week", "month", "year", "all"];

  function selectFilter(nextFilter) {
    setFilter(nextFilter);
    setPeriodDate(new Date());
    setCategoryFilter("all");
  }

  function movePeriod(amount) {
    setPeriodDate((current) => shiftPeriod(current, filter, amount));
    setCategoryFilter("all");
  }

  const expenseRows = useMemo(() => visibleExpenses.map((e, i) => (
              <div
                key={e.id}
                style={{
                  ...s.row,
                  ...(i === visibleExpenses.length - 1
                    ? { borderBottom: "none" }
                    : {}),
                }}
              >
                <div style={s.rowMain}>
                  <div style={s.rowLeft}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        flexWrap: "wrap",
                        marginBottom: "2px",
                      }}
                    >
                      <p style={s.reason}>{e.reason}</p>
                      {e.categories && (
                        <span style={s.catTag}>{e.categories.name}</span>
                      )}
                    </div>
                    {e.notes && <p style={s.notes}>{e.notes}</p>}
                    <p style={s.date}>
                      {fmtFullExpenseDate(e.created_at)}
                    </p>
                  </div>
                  <p style={s.amount}>{fmt(e.amount)}</p>
                </div>
                <div style={s.rowActions}>
                  {otherProfiles.length > 0 && (
                    <button type="button"
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
                  <button type="button"
                    style={{ ...s.actionBtn, color: "var(--muted)" }}
                    onClick={() => deleteExpense(e)}
                  >
                    delete
                  </button>
                </div>
              </div>
            )), [visibleExpenses, otherProfiles, deleteExpense]);

  if (loading || (dataError && !profiles.length)) return <DataStatus error={dataError} />;

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={s.header}>
          <span style={s.logo}>EXPENSES</span>
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

        {/* Time filter bar */}
        <div style={s.filterBar}>
          {timeFilters.map((f) => (
            <button type="button"
              key={f}
              style={{
                ...s.filterBtn,
                ...(filter === f ? s.filterActive : {}),
              }}
              onClick={() => selectFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {filter !== "all" && (
          <div style={s.periodNav} aria-label="Choose time period">
            <button
              type="button"
              style={s.periodButton}
              onClick={() => movePeriod(-1)}
              aria-label={`Previous ${filter}`}
            >
              ←
            </button>
            <p style={s.periodLabel}>{formatPeriod(periodDate, filter)}</p>
            <button
              type="button"
              style={{
                ...s.periodButton,
                ...(isCurrentPeriod(periodDate, filter)
                  ? s.periodButtonDisabled
                  : {}),
              }}
              onClick={() => movePeriod(1)}
              disabled={isCurrentPeriod(periodDate, filter)}
              aria-label={`Next ${filter}`}
            >
              →
            </button>
          </div>
        )}

        {/* Category filter — only shown when categories exist in this period */}
        {activeCategories.length > 0 && (
          <div style={s.catFilterRow}>
            <button type="button"
              style={{
                ...s.catFilterBtn,
                ...(categoryFilter === "all" ? s.catFilterActive : {}),
              }}
              onClick={() => setCategoryFilter("all")}
            >
              all
            </button>
            {activeCategories.map((c) => (
              <button type="button"
                key={c.id}
                style={{
                  ...s.catFilterBtn,
                  ...(categoryFilter === c.id ? s.catFilterActive : {}),
                }}
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Summary */}
        {visibleExpenses.length > 0 && (
          <div style={s.summary}>
            <span style={s.summaryLabel}>
              {visibleExpenses.length} expense
              {visibleExpenses.length !== 1 ? "s" : ""}
              {categoryFilter !== "all" &&
                ` · ${categories.find((c) => c.id === categoryFilter)?.name}`}
            </span>
            <span style={s.summaryTotal}>{fmt(totalFiltered)}</span>
          </div>
        )}

        {/* Expense list */}
        {visibleExpenses.length > 0 ? (
          <div style={s.list}>
            {expenseRows}
          </div>
        ) : (
          <p style={s.empty}>no expenses for this period.</p>
        )}
      </div>

      {/* Transfer Modal */}
      {transferExpense && (
        <Modal title="transfer expense" style={s.modal} overlayStyle={s.overlay}
          busy={transferring} onClose={() => setTransferExpense(null)} onSubmit={handleTransfer}
          onError={(error) => { setTErr(error.message || "could not transfer"); setTransferring(false); }}>
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
                <button type="button"
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
              <button type="button"
                style={s.mCancel}
                disabled={transferring}
                onClick={() => setTransferExpense(null)}
              >
                cancel
              </button>
              <button
                style={s.mConfirm}
                type="submit"
                disabled={transferring || !transferTargetId}
              >
                {transferring ? "transferring..." : "confirm transfer"}
              </button>
            </div>
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

  header: { marginBottom: "20px" },
  logo: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" },

  tabs: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" },
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

  filterBar: { display: "flex", gap: "4px", marginBottom: "10px" },
  filterBtn: {
    padding: "5px 10px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "11px",
    color: "var(--muted)",
    cursor: "pointer",
  },
  filterActive: {
    border: "1px solid #000",
    color: "#000",
    background: "var(--subtle)",
    fontWeight: 600,
  },

  periodNav: {
    display: "grid",
    gridTemplateColumns: "38px 1fr 38px",
    alignItems: "center",
    border: "1px solid var(--border-light)",
    marginBottom: "14px",
  },
  periodButton: {
    height: "34px",
    border: "none",
    background: "transparent",
    fontSize: "16px",
    lineHeight: 1,
    color: "var(--text)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  periodButtonDisabled: { color: "#c7c7c7", cursor: "not-allowed" },
  periodLabel: {
    fontSize: "11px",
    fontWeight: 600,
    textAlign: "center",
    borderLeft: "1px solid var(--border-light)",
    borderRight: "1px solid var(--border-light)",
    lineHeight: "34px",
  },

  catFilterRow: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
    marginBottom: "14px",
  },
  catFilterBtn: {
    padding: "4px 9px",
    border: "1px solid var(--border-light)",
    background: "transparent",
    fontSize: "10px",
    color: "var(--muted)",
    cursor: "pointer",
  },
  catFilterActive: {
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
  reason: { fontSize: "13px", fontWeight: 500 },
  catTag: {
    fontSize: "9px",
    padding: "2px 6px",
    border: "1px solid var(--border-light)",
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
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
    cursor: "pointer",
  },

  empty: {
    fontSize: "12px",
    color: "var(--muted)",
    textAlign: "center",
    padding: "40px 0",
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
    cursor: "pointer",
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
    cursor: "pointer",
  },
  mConfirm: {
    flex: 2,
    padding: "10px",
    border: "none",
    background: "#000",
    color: "#fff",
    fontSize: "13px",
    cursor: "pointer",
  },
};
