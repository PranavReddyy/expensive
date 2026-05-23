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
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(1) + "Cr";
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000) return "₹" + (n / 1000).toFixed(1) + "k";
  return "₹" + Math.round(n);
};

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

function buildCumulativeData(expenses, filter) {
  const now = new Date();

  if (filter === "month") {
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const daily = {};
    for (let d = 1; d <= daysInMonth; d++) daily[d] = 0;
    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      ) {
        daily[d.getDate()] = (daily[d.getDate()] || 0) + parseFloat(e.amount);
      }
    });
    let cum = 0;
    return Object.entries(daily).map(([d, v]) => {
      cum += v;
      const day = parseInt(d);
      return { label: day % 7 === 1 ? String(day) : "", value: cum, day };
    });
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
    const monthly = {};
    months.forEach((m) => {
      monthly[m] = 0;
    });
    expenses.forEach((e) => {
      const d = new Date(e.created_at);
      if (d.getFullYear() === now.getFullYear()) {
        monthly[months[d.getMonth()]] += parseFloat(e.amount);
      }
    });
    let cum = 0;
    return months.map((m) => {
      cum += monthly[m];
      return { label: m, value: cum };
    });
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

function getPrevRange(filter) {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  if (filter === "day") {
    start.setDate(now.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(now.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "week") {
    start.setDate(now.getDate() - now.getDay() - 7);
    start.setHours(0, 0, 0, 0);
    end.setDate(now.getDate() - now.getDay() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "month") {
    start.setMonth(now.getMonth() - 1, 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "year") {
    start.setFullYear(now.getFullYear() - 1, 0, 1);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(now.getFullYear() - 1, 11, 31);
    end.setHours(23, 59, 59, 999);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function getDaysInfo(filter) {
  const now = new Date();
  if (filter === "month") {
    const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsed = now.getDate();
    const remaining = total - elapsed;
    return { elapsed, remaining, total };
  }
  if (filter === "week") {
    const elapsed = now.getDay() + 1;
    const remaining = 7 - elapsed;
    return { elapsed, remaining, total: 7 };
  }
  if (filter === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const elapsed = Math.ceil((now - start) / 86400000);
    const total = now.getFullYear() % 4 === 0 ? 366 : 365;
    return { elapsed, remaining: total - elapsed, total };
  }
  return null;
}

function BarChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.length;
  const chartH = 100;
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
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="var(--fg, #000)"
            />
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

function LineChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 320;
  const H = 100;
  const pad = 4;
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - (d.value / max) * (H - pad * 2);
    return `${x},${y}`;
  });
  const linePath = `M ${pts.join(" L ")}`;
  const areaPath = `M ${pts[0]} L ${pts.join(" L ")} L ${320 - pad},${H} L ${pad},${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 20}`}
      style={{ width: "100%", display: "block" }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={linePath} fill="none" stroke="#000" strokeWidth="1.5" />
      {data.map((d, i) => {
        if (!d.label) return null;
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        return (
          <text
            key={i}
            x={x}
            y={H + 14}
            textAnchor="middle"
            fontSize="9"
            fill="#999"
            fontFamily="IBM Plex Mono, monospace"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, total }) {
  if (!data || data.length === 0) return null;
  const R = 44;
  const cx = 60;
  const cy = 60;

  const COLORS = ["#000", "#555", "#888", "#aaa", "#ccc"];
  let cumAngle = -Math.PI / 2;

  const slices = data.map(([category, amount], i) => {
    const pct = total > 0 ? amount / total : 0;
    const angle = pct * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(cumAngle);
    const y2 = cy + R * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    return {
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      color: COLORS[i % COLORS.length],
      category,
      amount,
      pct,
    };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <svg
        viewBox="0 0 120 120"
        style={{ width: 100, height: 100, flexShrink: 0 }}
      >
        {slices.map((sl, i) => (
          <path key={i} d={sl.path} fill={sl.color} />
        ))}
        <circle cx={cx} cy={cy} r={26} fill="white" />
        <text
          x={cx}
          y={cy - 5}
          textAnchor="middle"
          fontSize="8"
          fill="#999"
          fontFamily="IBM Plex Mono, monospace"
        >
          top
        </text>
        <text
          x={cx}
          y={cy + 7}
          textAnchor="middle"
          fontSize="8"
          fill="#999"
          fontFamily="IBM Plex Mono, monospace"
        >
          spend
        </text>
      </svg>
      <div style={{ flex: 1 }}>
        {slices.map((sl, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              marginBottom: "6px",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: sl.color,
                flexShrink: 0,
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: "11px",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sl.category}
            </span>
            <span
              style={{ fontSize: "11px", color: "#888", whiteSpace: "nowrap" }}
            >
              {(sl.pct * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeltaBadge({ current, prev }) {
  if (prev === 0) return null;
  const pct = ((current - prev) / prev) * 100;
  const up = pct > 0;
  return (
    <span
      style={{
        fontSize: "10px",
        padding: "2px 6px",
        border: "1px solid #ddd",
        color: up ? "#c00" : "#080",
        letterSpacing: "0.02em",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function AnalyticsPage() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState("bar");

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

  // Fetch with category join — no icon column
  const loadExpenses = useCallback(async (profileId) => {
    if (!profileId) return;
    const { data } = await supabase
      .from("expenses")
      .select("*, categories(id, name)")
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

  const rangeStart = new Date(getRange(filter));
  const filteredExpenses = expenses.filter(
    (e) => new Date(e.created_at) >= rangeStart,
  );

  const { start: prevStart, end: prevEnd } = getPrevRange(filter);
  const prevExpenses = expenses.filter((e) => {
    const d = new Date(e.created_at);
    return d >= new Date(prevStart) && d <= new Date(prevEnd);
  });

  const chartData = buildChartData(expenses, filter);
  const cumulData = buildCumulativeData(filteredExpenses, filter);

  const total = filteredExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const prevTotal = prevExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const avg = filteredExpenses.length > 0 ? total / filteredExpenses.length : 0;
  const maxSingle =
    filteredExpenses.length > 0
      ? Math.max(...filteredExpenses.map((e) => parseFloat(e.amount)))
      : 0;

  const daysInfo = getDaysInfo(filter);
  const burnRate =
    daysInfo && daysInfo.elapsed > 0 ? total / daysInfo.elapsed : 0;
  const projected = daysInfo ? burnRate * daysInfo.total : 0;
  const balanceAfter = active ? active.balance - projected : null;

  // Group by category name — uncategorized if no category
  const categoryTotals = {};
  filteredExpenses.forEach((e) => {
    const cat = e.categories?.name || "uncategorized";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(e.amount);
  });
  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Biggest single expense
  const biggestExpense =
    filteredExpenses.length > 0
      ? filteredExpenses.reduce(
          (max, e) => (parseFloat(e.amount) > parseFloat(max.amount) ? e : max),
          filteredExpenses[0],
        )
      : null;

  // Most frequent day of week
  const dayCounts = {};
  filteredExpenses.forEach((e) => {
    const d = new Date(e.created_at).toLocaleDateString("en-US", {
      weekday: "short",
    });
    dayCounts[d] = (dayCounts[d] || 0) + 1;
  });
  const busiest = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

  const filters = ["day", "week", "month", "year"];

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

        {/* Primary stats */}
        <div style={s.statsGrid}>
          <div style={s.statBox}>
            <p style={s.statLabel}>total spent</p>
            <p style={s.statVal}>{fmt(total)}</p>
            <div style={{ marginTop: "4px" }}>
              <DeltaBadge current={total} prev={prevTotal} />
            </div>
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>transactions</p>
            <p style={s.statVal}>{filteredExpenses.length}</p>
            <DeltaBadge
              current={filteredExpenses.length}
              prev={prevExpenses.length}
            />
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>avg / expense</p>
            <p style={s.statVal}>{fmt(avg)}</p>
          </div>
          <div style={s.statBox}>
            <p style={s.statLabel}>largest</p>
            <p style={s.statVal}>{fmt(maxSingle)}</p>
            {biggestExpense?.categories && (
              <p
                style={{
                  fontSize: "9px",
                  color: "var(--muted)",
                  marginTop: "2px",
                }}
              >
                {biggestExpense.categories.name}
              </p>
            )}
          </div>
        </div>

        {/* Burn rate & projection */}
        {daysInfo && filteredExpenses.length > 0 && (
          <div style={s.insightRow}>
            <div style={s.insightBox}>
              <p style={s.statLabel}>daily burn</p>
              <p style={{ fontSize: "13px", fontWeight: 600 }}>
                {fmtShort(burnRate)}/day
              </p>
            </div>
            <div style={s.insightBox}>
              <p style={s.statLabel}>projected {filter}</p>
              <p style={{ fontSize: "13px", fontWeight: 600 }}>
                {fmtShort(projected)}
              </p>
            </div>
            <div style={s.insightBox}>
              <p style={s.statLabel}>days left</p>
              <p style={{ fontSize: "13px", fontWeight: 600 }}>
                {daysInfo.remaining}
              </p>
            </div>
          </div>
        )}

        {/* Busiest day callout */}
        {busiest && filter !== "day" && (
          <div style={s.callout}>
            <span style={s.calloutDot} />
            <p style={s.calloutText}>
              you spend most on <strong>{busiest[0]}</strong>s — {busiest[1]}{" "}
              transaction{busiest[1] > 1 ? "s" : ""} this {filter}
            </p>
          </div>
        )}

        {/* Chart area */}
        {filteredExpenses.length > 0 ? (
          <div style={s.chartBox}>
            <div style={s.chartHeader}>
              <p style={s.chartTitle}>spending — {filter}</p>
              <div style={{ display: "flex", gap: "4px" }}>
                {["bar", "cumulative"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMode(m)}
                    style={{
                      fontSize: "9px",
                      padding: "3px 7px",
                      border: "1px solid",
                      borderColor:
                        chartMode === m ? "#000" : "var(--border-light)",
                      background: "transparent",
                      color: chartMode === m ? "#000" : "var(--muted)",
                      fontWeight: chartMode === m ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {m === "bar" ? "BAR" : "LINE"}
                  </button>
                ))}
              </div>
            </div>

            {chartMode === "bar" ? (
              <BarChart data={chartData} />
            ) : (filter === "month" || filter === "year") &&
              cumulData.length > 0 ? (
              <LineChart data={cumulData} />
            ) : (
              <p style={s.empty}>cumulative view not available for {filter}</p>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "4px",
              }}
            >
              <p style={{ ...s.chartTitle, fontSize: "9px" }}>0</p>
              <p style={{ ...s.chartTitle, fontSize: "9px" }}>
                peak {fmtShort(Math.max(...chartData.map((d) => d.value), 0))}
              </p>
            </div>
          </div>
        ) : (
          <div style={s.chartBox}>
            <p style={s.empty}>no data for this period.</p>
          </div>
        )}

        {/* Category donut */}
        {topCategories.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>by category</p>
            <div style={s.catCard}>
              <DonutChart data={topCategories} total={total} />
            </div>
          </div>
        )}

        {/* Top categories bar breakdown */}
        {topCategories.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>top by category</p>
            <div style={s.reasonList}>
              {topCategories.map(([category, amount], i) => {
                const pct = total > 0 ? (amount / total) * 100 : 0;
                return (
                  <div key={category} style={s.reasonRow}>
                    <div style={s.reasonLeft}>
                      <span style={s.reasonRank}>{i + 1}</span>
                      <span style={s.reasonName}>{category}</span>
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

        {/* Balance row */}
        {active && (
          <div style={s.section}>
            <div style={s.balanceRow}>
              <span style={s.sectionLabel}>balance — {active.name}</span>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>
                {fmt(active.balance)}
              </span>
            </div>
            {daysInfo && projected > 0 && (
              <div
                style={{
                  ...s.balanceRow,
                  borderTop: "none",
                  paddingTop: 0,
                  marginTop: "-1px",
                }}
              >
                <span style={s.sectionLabel}>balance after projected</span>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: balanceAfter < 0 ? "#c00" : "inherit",
                  }}
                >
                  {fmt(active.balance - projected)}
                  {balanceAfter < 0 && " (!)"}
                </span>
              </div>
            )}
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
    cursor: "pointer",
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
    cursor: "pointer",
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
    marginBottom: "8px",
  },
  statBox: { border: "1px solid var(--border-light)", padding: "12px" },
  statLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    marginBottom: "4px",
    letterSpacing: "0.04em",
  },
  statVal: { fontSize: "14px", fontWeight: 600 },

  insightRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "8px",
    marginBottom: "8px",
    marginTop: "8px",
  },
  insightBox: {
    border: "1px solid var(--border-light)",
    padding: "10px 12px",
    borderStyle: "dashed",
  },

  callout: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    border: "1px solid var(--border-light)",
    padding: "10px 12px",
    marginBottom: "16px",
    background: "var(--subtle)",
  },
  calloutDot: {
    width: "6px",
    height: "6px",
    background: "#000",
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: "4px",
  },
  calloutText: { fontSize: "11px", color: "var(--muted)", lineHeight: "1.5" },

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

  section: { marginBottom: "20px" },
  sectionLabel: {
    fontSize: "10px",
    color: "var(--muted)",
    letterSpacing: "0.06em",
    marginBottom: "8px",
    marginTop: "4px",
  },

  catCard: { border: "1px solid var(--border-light)", padding: "14px" },

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
  reasonName: {
    fontSize: "12px",
    fontWeight: 500,
    maxWidth: "80px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
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
    // border: "1px solid var(--border-light)",
    padding: "0px",
    marginBottom: "0",
  },
};
