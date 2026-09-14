"use client";
import Nav from "./Nav";
import { queryCache } from "../lib/query-cache.mjs";

export default function DataStatus({ error }) {
  return <>
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>
      <p>{error ? "could not load data" : "loading..."}</p>
      {error && <button type="button" onClick={() => queryCache.invalidate()} style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--border-light)" }}>retry</button>}
    </div>
    <Nav />
  </>;
}
