export const EMPTY_QUERY = Object.freeze({ data: undefined, error: null, pending: false });

export function createQueryCache() {
  const entries = new Map();
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
    for (const item of entries.values()) {
      if (tables && !item.tables.some((table) => tables.includes(table))) continue;
      item.dirty = true;
      item.version++;
      if (item.listeners.size) load(item);
    }
  }

  function clear() {
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

  return { entry, load, subscribe, invalidate, clear };
}

// Session memory only: financial data is never persisted to browser storage.
export const queryCache = createQueryCache();
