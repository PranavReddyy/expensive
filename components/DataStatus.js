"use client";
import Nav from "./Nav";
import { queryCache } from "../lib/query-cache.mjs";
import LoadingState from './LoadingState';

export default function DataStatus({ error }) {
  return <>
    <div style={{ minHeight: "100dvh", maxWidth:480, margin:'0 auto', padding:'28px 20px', display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", color: "var(--muted)", fontSize: 12 }}>
      {error ? <p>could not load data</p> : <LoadingState label="loading your accounts" />}
      {error && <button type="button" onClick={() => queryCache.invalidate()} style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--border-light)" }}>retry</button>}
    </div>
    <Nav />
  </>;
}
