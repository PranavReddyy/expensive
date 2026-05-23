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

const fmtShort = (n) => {
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000) return "₹" + (n / 1000).toFixed(1) + "k";
  return "₹" + Math.round(n);
};

// Build chart data based on filter
function buildChartData(expenses, filter) {
  const now = new Date();
  const buckets = {};

  if (filter === "day") {
    for (let h = 0; h < 24; h++) buckets[h] = 0;
    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (d.toDateString() === now.toDateString()) {
        buckets[d.getHours()] =
          (buckets[d.getHours()] || 0) + parseFloat(e.amount);
      }
    });
    return Object.entries(buckets).map(([h, v]) => ({
      label: parseInt(h) % 6 === 0 ? `${h}h` : "",
      value: v,
    }));
  }

  if (filter === "week") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    days.forEach((d) => {
      buckets[d] = 0;
    });
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (d >= weekStart) {
        const key = days[d.getDay()];
        buckets[key] = (buckets[key] || 0) + parseFloat(e.amount);
      }
    });
    return days.map((d) => ({ label: d, value: buckets[d] }));
  }

  if (filter === "month") {
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    for (let d = 1; d <= daysInMonth; d++) buckets[d] = 0;

    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      ) {
        const day = d.getDate();
        buckets[day] = (buckets[day] || 0) + parseFloat(e.amount);
      }
    });
    return Object.entries(buckets).map(([d, v]) => ({
      label: parseInt(d) % 7 === 1 ? d : "",
      value: v,
    }));
  }

  if (filter === "year") {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    months.forEach((m) => {
      buckets[m] = 0;
    });

    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (d.getFullYear() === now.getFullYear()) {
        const key = months[d.getMonth()];
        buckets[key] = (buckets[key] || 0) + parseFloat(e.amount);
      }
    });
    return months.map((m) => ({ label: m, value: buckets[m] }));
  }

  return [];
}

function getRange(filter) {
  const now = new Date();
  const start = new Date();

  if (filter === "day") {
    start.setHours(0, 0, 0, 0);
  } else if (filter === "week") {
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
  } else if (filter === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (filter === "year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }

  return start.toISOString();
}

function BarChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.length;
  const chartH = 120;
  const barW = Math.max(Math.floor((320 - total * 1) / total), 2);

  return (
    <svg
      viewBox={`0 0 320 ${chartH + 20}`}
      style={{ width: "100%", display: "block" }}
      preserveAspectRatio="none"
    >
      {data.map((d, i) => {
        const barH = Math.max((d.value / max) * chartH, d.value > 0 ? 2 : 0);
        const x = i * (barW + 1);
        const y = chartH - barH;

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill="#000" />
            {d.label && (
              <text
                x={x + barW / 2}
                y={chartH + 14}
                textAnchor="middle"
                fontSize="9"
                fill="#999"
                fontFamily="IBM Plex Mono, monospace"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsPage() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);

  const active = profiles.find((p) => p.id === activeId);

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

  const loadExpenses = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true });
    setExpenses(data || []);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (activeId) loadExpenses(activeId);
  }, [activeId, loadExpenses]);

  // Realtime
  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`analytics-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `profile_id=eq.${activeId}`,
        },
        () => loadExpenses(activeId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId, loadExpenses]);

  function switchProfile(id) {
    setActiveId(id);
    if (typeof window !== "undefined")
      localStorage.setItem("activeProfileId", id);
  }

  // Filter expenses by selected period
  const rangeStart = new Date(getRange(filter));
  const filteredExpenses = expenses.filter(
    (e) => new Date(e.created_at) >= rangeStart,
  );
  const chartData = buildChartData(expenses, filter);

  const total = filteredExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const avg = filteredExpenses.length > 0 ? total / filteredExpenses.length : 0;
  const maxSingle =
    filteredExpenses.length > 0
      ? Math.max(...filteredExpenses.map((e) => parseFloat(e.amount)))
      : 0;

  const filters = ["day", "week", "month", "year"];

  // Top reasons
  const reasonTotals = {};
  filteredExpenses.forEach((e) => {
    const r = e.reason.toLowerCase();
    reasonTotals[r] = (reasonTotals[r] || 0) + parseFloat(e.amount);
  });
  const topReasons = Object.entries(reasonTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

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
        <div style={s.header}>
          <span style={s.logo}>ANALYTICS</span>
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

        {/* Filter */}
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

        {/* Stats row */}
        <div style={s.statsGrid}>
          <div style={s.statBox}>
            <p style={s.statLabel}>total spent</p>
            <p style={s.statVal}>{fmt(total)}</p>
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>avg / expense</p>
            <p style={s.statVal}>{fmt(avg)}</p>
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>transactions</p>
            <p style={s.statVal}>{filteredExpenses.length}</p>
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>largest</p>
            <p style={s.statVal}>{fmt(maxSingle)}</p>
          </div>
        </div>

        {/* Chart */}
        {filteredExpenses.length > 0 ? (
          <div style={s.chartBox}>
            <div style={s.chartHeader}>
              <p style={s.chartTitle}>spending — {filter}</p>
              <p style={s.chartMax}>
                {fmtShort(Math.max(...chartData.map((d) => d.value), 0))}
              </p>
            </div>
            <BarChart data={chartData} />
          </div>
        ) : (
          <div style={s.chartBox}>
            <p style={s.empty}>no data for this period.</p>
          </div>
        )}

        {/* Top categories */}
        {topReasons.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>top by reason</p>
            <div style={s.reasonList}>
              {topReasons.map(([reason, amount], i) => {
                const pct = total > 0 ? (amount / total) * 100 : 0;
                return (
                  <div key={reason} style={s.reasonRow}>
                    <div style={s.reasonLeft}>
                      <span style={s.reasonRank}>{i + 1}</span>
                      <span style={s.reasonName}>{reason}</span>
                    </div>
                    <div style={s.reasonRight}>
                      <div style={s.bar}>
                        <div style={{ ...s.barFill, width: `${pct}%` }} />
                      </div>
                      <span style={s.reasonAmt}>{fmt(amount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Balance info */}
        {active && (
          <div style={s.balanceRow}>
            <span style={s.sectionLabel}>current balance — {active.name}</span>
            <span style={{ fontSize: "14px", fontWeight: 600 }}>
              {fmt(active.balance)}
            </span>
          </div>
        )}
      </div>
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

  filterBar: { display: "flex", gap: "4px", marginBottom: "20px" },
  filterBtn: {
    flex: 1,
    padding: "7px 4px",
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

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginBottom: "20px",
  },
  statBox: { border: "1px solid var(--border-light)", padding: "12px" },
  statLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    marginBottom: "4px",
    letterSpacing: "0.04em",
  },
  statVal: { fontSize: "14px", fontWeight: 600 },

  chartBox: {
    border: "1px solid var(--border-light)",
    padding: "14px",
    marginBottom: "20px",
  },
  chartHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  },
  chartTitle: { fontSize: "11px", color: "var(--muted)" },
  chartMax: { fontSize: "11px", color: "var(--muted)" },

  section: { marginBottom: "20px" },
  sectionLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    letterSpacing: "0.06em",
    marginBottom: "10px",
  },

  reasonList: { display: "flex", flexDirection: "column", gap: "8px" },
  reasonRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
  },
  reasonLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "100px",
    flex: "0 0 auto",
  },
  reasonRank: { fontSize: "10px", color: "var(--muted)", width: "12px" },
  reasonName: { fontSize: "12px", fontWeight: 500 },
  reasonRight: { display: "flex", alignItems: "center", gap: "8px", flex: 1 },
  bar: { flex: 1, height: "4px", background: "var(--border-light)" },
  barFill: {
    height: "100%",
    background: "#000",
    minWidth: "2px",
    transition: "width 0.3s",
  },
  reasonAmt: {
    fontSize: "11px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    minWidth: "70px",
    textAlign: "right",
  },

  empty: {
    fontSize: "12px",
    color: "var(--muted)",
    textAlign: "center",
    padding: "20px 0",
  },

  balanceRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid var(--border-light)",
    padding: "12px",
    marginBottom: "8px",
  },
};
