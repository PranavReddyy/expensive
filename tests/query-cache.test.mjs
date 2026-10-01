import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCache, EMPTY_QUERY } from '../lib/query-cache.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((done) => setImmediate(done));

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('session snapshots hydrate only their owner and revalidate without blanking data', async () => {
  const storage = memoryStorage();
  const cache = createQueryCache({ storage });
  cache.setOwner('alice');
  const key = JSON.stringify(['alice', 'profiles']);
  await cache.load(query(cache, key, ['profiles'], async () => [100]));
  const restored = createQueryCache({ storage });
  restored.setOwner('alice');
  const item = query(restored, key, ['profiles'], async () => [200]);
  assert.deepEqual(item.snapshot.data, [100]);
  assert.equal(item.dirty, true);
  const loading = restored.load(item);
  assert.deepEqual(item.snapshot.data, [100]);
  await loading;
  assert.deepEqual(item.snapshot.data, [200]);
  restored.setOwner('bob');
  assert.equal(restored.entry(key).snapshot, EMPTY_QUERY);
  assert.equal(storage.getItem('expensive.snapshot.v1:alice'), undefined);
});

test('expired snapshots, logout and money invalidation cannot resurrect persisted balances', async () => {
  const storage = memoryStorage();
  const key = JSON.stringify(['alice', 'profiles']);
  const cache = createQueryCache({ storage, now: () => 100 });
  cache.setOwner('alice');
  const item = query(cache, key, ['profiles'], async () => [100]);
  await cache.load(item);
  const expired = createQueryCache({ storage, now: () => 3_600_101 });
  expired.setOwner('alice');
  assert.equal(expired.entry(key).snapshot, EMPTY_QUERY);
  cache.invalidate(['profiles']);
  await cache.load(item);
  cache.invalidate(['profiles']);
  assert.equal(storage.getItem('expensive.snapshot.v1:alice'), undefined);
  await cache.load(item);
  cache.clear();
  assert.equal(storage.getItem('expensive.snapshot.v1:alice'), undefined);
});

function query(cache, key, tables, fetcher) {
  const item = cache.entry(key, tables);
  item.fetcher = fetcher;
  return item;
}

test('returning to a loaded page reads cached data without another request', async () => {
  const cache = createQueryCache();
  let reads = 0;
  const expenses = query(cache, 'expenses:p1:month', ['expenses'], async () => { reads++; return [125]; });
  let leave = cache.subscribe(expenses, () => {});
  await cache.load(expenses);
  leave();
  leave = cache.subscribe(expenses, () => {});
  const cached = expenses.snapshot;
  await cache.load(expenses);
  assert.equal(reads, 1);
  assert.equal(expenses.snapshot, cached);
  assert.deepEqual(cached.data, [125]);
  leave();
});

test('concurrent consumers share one in-flight request', async () => {
  const cache = createQueryCache();
  const pending = deferred();
  let reads = 0;
  const profiles = query(cache, 'profiles', ['profiles'], () => { reads++; return pending.promise; });
  const first = cache.load(profiles);
  const second = cache.load(profiles);
  assert.equal(first, second);
  pending.resolve(['personal']);
  await first;
  assert.equal(reads, 1);
});

test('an update refreshes active dependent queries and marks inactive pages stale', async () => {
  const cache = createQueryCache();
  let homeReads = 0;
  let historyReads = 0;
  let profileReads = 0;
  const home = query(cache, 'recent', ['expenses', 'categories'], async () => ++homeReads);
  const history = query(cache, 'history', ['expenses', 'categories'], async () => ++historyReads);
  const profiles = query(cache, 'profiles', ['profiles'], async () => ++profileReads);
  cache.subscribe(home, () => {});
  await Promise.all([cache.load(home), cache.load(history), cache.load(profiles)]);
  cache.invalidate(['expenses']);
  await tick();
  assert.equal(homeReads, 2);
  assert.equal(historyReads, 1);
  assert.equal(profileReads, 1);
  assert.equal(history.dirty, true);
  await cache.load(history);
  assert.equal(historyReads, 2);
  cache.invalidate(['categories']);
  await tick();
  assert.equal(homeReads, 3); // Joined names refresh too.
});

test('an old response cannot overwrite an update received during its request', async () => {
  const cache = createQueryCache();
  const old = deferred();
  let reads = 0;
  const item = query(cache, 'balance', ['profiles'], () => ++reads === 1 ? old.promise : Promise.resolve(200));
  const committed = [];
  cache.subscribe(item, () => { if (item.snapshot.data !== undefined) committed.push(item.snapshot.data); });
  const first = cache.load(item);
  await tick();
  cache.invalidate(['profiles']);
  cache.invalidate(['profiles']);
  old.resolve(100);
  await first;
  await tick();
  assert.equal(reads, 2);
  assert.equal(item.snapshot.data, 200);
  assert.ok(!committed.includes(100));
});

test('profile and period keys stay isolated when responses arrive out of order', async () => {
  const cache = createQueryCache();
  const slow = deferred();
  const first = query(cache, 'p1:month', ['expenses'], () => slow.promise);
  const second = query(cache, 'p2:month', ['expenses'], async () => ['p2']);
  const historical = query(cache, 'p1:last-month', ['expenses'], async () => ['old']);
  const pending = cache.load(first);
  await Promise.all([cache.load(second), cache.load(historical)]);
  slow.resolve(['p1']);
  await pending;
  assert.deepEqual(second.snapshot.data, ['p2']);
  assert.deepEqual(historical.snapshot.data, ['old']);
});

test('logout clears financial data and ignores an outstanding response', async () => {
  const cache = createQueryCache();
  const slow = deferred();
  let signal;
  const item = query(cache, 'profiles', ['profiles'], (next) => { signal = next; return slow.promise; });
  const pending = cache.load(item);
  await tick();
  cache.clear();
  assert.equal(signal.aborted, true);
  slow.resolve(['private']);
  await pending;
  assert.equal(item.snapshot, EMPTY_QUERY);
  item.fetcher = async () => ['new session'];
  await cache.load(item);
  assert.deepEqual(item.snapshot.data, ['new session']);
});

test('a failed refresh retains cached data and can be retried without a loop', async () => {
  const cache = createQueryCache();
  let reads = 0;
  const item = query(cache, 'expenses', ['expenses'], async () => {
    reads++;
    if (reads === 2) throw new Error('offline');
    return reads;
  });
  cache.subscribe(item, () => {});
  await cache.load(item);
  cache.invalidate(['expenses']);
  await tick();
  assert.equal(reads, 2);
  assert.equal(item.snapshot.data, 1);
  assert.equal(item.snapshot.error.message, 'offline');
  await cache.load(item);
  assert.equal(item.snapshot.data, 3);
  assert.equal(item.snapshot.error, null);
});
