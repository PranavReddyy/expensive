"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { queryCache, EMPTY_QUERY } from "./query-cache.mjs";
import { supabase } from "./supabase";

const EMPTY_ROWS = Object.freeze([]);
const serverSnapshot = () => EMPTY_QUERY;
let selectedProfile = null;
const profileListeners = new Set();
const subscribeProfile = (listener) => {
  profileListeners.add(listener);
  return () => profileListeners.delete(listener);
};
export function selectProfile(id) {
  selectedProfile = id;
  try { localStorage.setItem("activeProfileId", id || ""); } catch {}
  profileListeners.forEach((listener) => listener());
}
export function resetSession() {
  selectedProfile = null;
  viewState.clear();
  queryCache.clear();
  profileListeners.forEach((listener) => listener());
}

export function useQuery(key, tables, fetcher, enabled = true) {
  const serializedKey = JSON.stringify(key);
  const item = useMemo(() => queryCache.entry(serializedKey, tables), [serializedKey]);
  const subscribe = useCallback((listener) => enabled
    ? queryCache.subscribe(item, listener) : () => {}, [item, enabled]);
  const getSnapshot = useCallback(() => enabled ? item.snapshot : EMPTY_QUERY, [item, enabled]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  useEffect(() => {
    if (!enabled) return;
    item.fetcher = fetcher;
    queryCache.load(item);
  }, [item, enabled]);
  return { ...snapshot, data: snapshot.data ?? EMPTY_ROWS };
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function useProfiles() {
  const result = useQuery(["profiles"], ["profiles"], (signal) => rows(
    supabase.from("profiles").select("*").order("created_at").abortSignal(signal),
  ));
  const selected = useSyncExternalStore(subscribeProfile, () => selectedProfile, () => null);
  useEffect(() => {
    if (!result.data.length || result.pending || result.error) return;
    let saved = selected;
    if (!saved) { try { saved = localStorage.getItem("activeProfileId"); } catch {} }
    const id = result.data.some((profile) => profile.id === saved) ? saved : result.data[0].id;
    if (selected !== id) selectProfile(id);
  }, [result.data, selected, result.pending, result.error]);
  const activeId = result.data.some((profile) => profile.id === selected)
    ? selected : result.data[0]?.id || null;
  return {
    profiles: result.data, activeId, switchProfile: selectProfile,
    loading: result.data === EMPTY_ROWS && !result.error,
    dataError: result.error,
  };
}

export function useCategories() {
  return useQuery(["categories"], ["categories"], (signal) => rows(
    supabase.from("categories").select("*").order("sort_order").abortSignal(signal),
  )).data;
}

export function useExpenses(profileId, { start, end, limit, amountsOnly = false, ascending = false } = {}) {
  return useQuery(["expenses", profileId, start, end, limit, amountsOnly, ascending],
    amountsOnly ? ["expenses"] : ["expenses", "categories"], async (signal) => {
      // Fetch all matching rows in bounded batches, avoiding Supabase's default
      // row cap silently truncating totals and analytics.
      const result = [];
      const batchSize = limit || 1000;
      for (let offset = 0; ; offset += batchSize) {
        let query = supabase.from("expenses")
          .select(amountsOnly ? "amount" : "*, categories(id, name)")
          .eq("profile_id", profileId).order("created_at", { ascending })
          .order("id", { ascending }).range(offset, offset + batchSize - 1).abortSignal(signal);
        if (start) query = query.gte("created_at", start);
        if (end) query = query.lt("created_at", end);
        const batch = await rows(query);
        result.push(...batch);
        if (limit || batch.length < batchSize) return result;
      }
    }, !!profileId);
}

export function usePeople(profileId) {
  return useQuery(["people", profileId], ["people"], (signal) => rows(
    supabase.from("people").select("*").eq("profile_id", profileId).order("name").abortSignal(signal),
  ), !!profileId).data;
}

export function useDebts(profileId) {
  return useQuery(["debts", profileId], ["debts", "people"], (signal) => rows(
    supabase.from("debts").select("*, people(id, name)").eq("profile_id", profileId)
      .order("created_at", { ascending: false }).abortSignal(signal),
  ), !!profileId).data;
}

const viewState = new Map();
export function usePageState(key, initial) {
  const [value, setValue] = useState(() => viewState.has(key) ? viewState.get(key)
    : typeof initial === "function" ? initial() : initial);
  useEffect(() => { viewState.set(key, value); }, [key, value]);
  return [value, setValue];
}
