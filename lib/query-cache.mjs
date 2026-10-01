export const EMPTY_QUERY = Object.freeze({ data: undefined, error: null, pending: false });

export function createQueryCache({ storage, now = Date.now } = {}) {
  const entries = new Map();
  let owner = null;
  const storageKey = () => `expensive.snapshot.v1:${owner}`;
  function discardSaved() { try { if (owner) storage?.removeItem(storageKey()); } catch {} }
  function persist() {
    if (!owner) return;
    try {
      const rows = [...entries.values()].filter(item => JSON.parse(item.key)[0] === owner && item.snapshot.data !== undefined && !item.dirty)
        .slice(-80).map(item => ({ key: item.key, tables: item.tables, data: item.snapshot.data }));
      const saved = JSON.stringify({ owner, at: now(), rows });
      if (saved.length < 1_000_000) storage?.setItem(storageKey(), saved);
      else discardSaved();
    } catch {} // Storage is optional (private browsing/quota).
  }
  function setOwner(next) {
    if (owner === next) return;
    clear(); owner = next;
    if (!owner) return;
    try {
      const saved = JSON.parse(storage?.getItem(storageKey()) || 'null');
      if (!saved || saved.owner !== owner || !Array.isArray(saved.rows) || !Number.isFinite(saved.at) || now() - saved.at > 3_600_000 || saved.at > now()) { discardSaved(); return; }
      for (const row of saved.rows.slice(-80)) {
        if (JSON.parse(row.key)[0] !== owner || !Array.isArray(row.tables)) continue;
        entry(row.key, row.tables).snapshot = { data: row.data, error: null, pending: false };
        // Hydrated data stays dirty: render immediately, then revalidate.
      }
    } catch { discardSaved(); }
  }
  const emit = (entry) => entry.listeners.forEach((listener) => listener());

  function entry(key, tables = []) {
    if (!entries.has(key)) {
      entries.set(key, {
        key, tables, snapshot: EMPTY_QUERY, dirty: true, version: 0,
        listeners: new Set(), fetcher: null, pending: null, controller: null,
      });
    }
    return entries.get(key);
  }

  function load(item) {
    if (item.pending) return item.pending;
    if (!item.dirty || !item.fetcher) return Promise.resolve(item.snapshot.data);
    const version = item.version;
    const controller = new AbortController();
    item.controller = controller;
    item.snapshot = { ...item.snapshot, error: null, pending: true };
    item.pending = Promise.resolve().then(() => item.fetcher(controller.signal)).then(
      (data) => {
        if (controller.signal.aborted || version !== item.version) return;
        item.dirty = false;
        item.snapshot = { data, error: null, pending: false };
        persist();
        emit(item);
        return data;
      },
      (error) => {
        if (controller.signal.aborted || version !== item.version) return;
        item.snapshot = { ...item.snapshot, error, pending: false };
        emit(item);
      },
    ).finally(() => {
      if (item.controller !== controller) return;
      item.pending = null;
      item.controller = null;
      // A change during a read invalidates that response. Fetch the new version
      // once, sharing the request among all mounted consumers.
      if (version !== item.version && item.listeners.size) load(item);
    });
    emit(item);
    return item.pending;
  }

  function subscribe(item, listener) {
    item.listeners.add(listener);
    return () => item.listeners.delete(listener);
  }

  function invalidate(tables) {
    discardSaved();
    for (const item of entries.values()) {
      if (tables && !item.tables.some((table) => tables.includes(table))) continue;
      item.dirty = true;
      item.version++;
      if (item.listeners.size) load(item);
    }
  }

  function clear() {
    discardSaved(); owner = null;
    for (const item of entries.values()) {
      item.controller?.abort();
      item.controller = null;
      item.pending = null;
      item.version++;
      item.dirty = true;
      item.snapshot = EMPTY_QUERY;
      emit(item);
    }
  }

  return { entry, load, subscribe, invalidate, clear, setOwner };
}

// Tab-session storage only; never localStorage. Read only after verified auth.
export const queryCache = createQueryCache({ storage: {
  getItem: key => typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null,
  setItem: (key, value) => { if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value); },
  removeItem: key => { if (typeof window !== 'undefined') window.sessionStorage.removeItem(key); },
} });
