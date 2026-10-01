"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { queryCache, EMPTY_QUERY } from "./query-cache.mjs";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";
import { clearPreview } from './startup-preview.mjs';

const EMPTY_ROWS = Object.freeze([]);
const serverSnapshot = () => EMPTY_QUERY;
let selectedProfile = null;
const profileListeners = new Set();
const subscribeProfile = (listener) => {
  profileListeners.add(listener);
  return () => profileListeners.delete(listener);
};
export function selectProfile(id, userId) {
  selectedProfile = id;
  try { if (userId) localStorage.setItem(`activeProfileId:${userId}`, id || ""); } catch {}
  profileListeners.forEach((listener) => listener());
}
export function resetSession({ preservePreview = false } = {}) {
  if (!preservePreview) { try { clearPreview(window.sessionStorage); } catch {} }
  selectedProfile = null;
  try { localStorage.removeItem("activeProfileId"); } catch {}
  viewState.clear();
  queryCache.clear();
  profileListeners.forEach((listener) => listener());
}

export function useQuery(key, tables, fetcher, enabled = true) {
  const { user, ready, validating } = useAuth();
  enabled = enabled && ready && !!user;
  const serializedKey = JSON.stringify([user?.id, ...key]);
  const item = useMemo(() => queryCache.entry(serializedKey, tables), [serializedKey]);
  const subscribe = useCallback((listener) => enabled
    ? queryCache.subscribe(item, listener) : () => {}, [item, enabled]);
  const getSnapshot = useCallback(() => enabled ? item.snapshot : EMPTY_QUERY, [item, enabled]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  useEffect(() => {
    if (!enabled || validating) return;
    item.fetcher = fetcher;
    queryCache.load(item);
  }, [item, enabled, validating]);
  return { ...snapshot, data: snapshot.data ?? EMPTY_ROWS };
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function useLedger() {
  return useQuery(['ledger-v1'], ['profiles','people','debts'], async signal => {
    async function all(table, order) {
      const result = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from(table).select('*').order(order).order('id').range(offset,offset+999).abortSignal(signal);
        if (table === 'debts') query = query.gt('remaining_amount',0);
        const batch = await rows(query);
        result.push(...batch); if (batch.length < 1000) return result;
      }
    }
    const [profiles,people,debts] = await Promise.all([all('profiles','created_at'),all('people','name'),all('debts','created_at')]);
    return {profiles,people,debts};
  });
}

export function useProfiles() {
  const { user } = useAuth();
  const ledger = useLedger();
  const result = {...ledger, data:ledger.data.profiles || EMPTY_ROWS};
  const selected = useSyncExternalStore(subscribeProfile, () => selectedProfile, () => null);
  const savedSelection = useMemo(() => {
    try { return user?.id ? localStorage.getItem(`activeProfileId:${user.id}`) : null; } catch { return null; }
  }, [user?.id]);
  useEffect(() => {
    if (!result.data.length || result.pending || result.error) return;
    let saved = selected;
    if (!saved) { try { saved = localStorage.getItem(`activeProfileId:${user?.id}`); } catch {} }
    const id = result.data.some((profile) => profile.id === saved) ? saved : result.data[0].id;
    if (selected !== id) selectProfile(id, user?.id);
  }, [result.data, selected, result.pending, result.error, user?.id]);
  const switchProfile = useCallback(id => selectProfile(id, user?.id), [user?.id]);
  const preferred = selected || savedSelection;
  const activeId = result.data.some((profile) => profile.id === preferred)
    ? preferred : result.data[0]?.id || null;
  return {
    profiles: result.data, activeId, switchProfile,
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
  const { data } = useLedger();
  return useMemo(() => (data.people || EMPTY_ROWS).filter(row => row.profile_id === profileId), [data,profileId]);
}

export function useDebts(profileId) {
  const { data } = useLedger();
  return useMemo(() => {
    const people = new Map((data.people || EMPTY_ROWS).map(person => [person.id,person]));
    return (data.debts || EMPTY_ROWS).filter(row => row.profile_id === profileId).map(row => ({...row,people:people.get(row.person_id)}));
  }, [data,profileId]);
}

const viewState = new Map();
export function usePageState(key, initial) {
  const [value, setValue] = useState(() => viewState.has(key) ? viewState.get(key)
    : typeof initial === "function" ? initial() : initial);
  useEffect(() => { viewState.set(key, value); }, [key, value]);
  return [value, setValue];
}
