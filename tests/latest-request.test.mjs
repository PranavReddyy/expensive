import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequest } from '../lib/latest-request.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('a slow old profile cannot replace a newer result, even if transport ignores abort', async () => {
  const request = createLatestRequest();
  const old = deferred();
  const commits = [];
  let oldSignal;
  const first = request.run(async (signal) => {
    oldSignal = signal;
    await old.promise;
    if (!signal.aborted) commits.push('old profile');
  });
  await request.run(async (signal) => {
    if (!signal.aborted) commits.push('new profile');
  });
  assert.equal(oldSignal.aborted, true);
  old.resolve();
  await first;
  assert.deepEqual(commits, ['new profile']);
});

test('finishing an obsolete request does not lose cancellation of its replacement', async () => {
  const request = createLatestRequest();
  const old = deferred();
  const current = deferred();
  let currentSignal;
  const first = request.run(() => old.promise);
  const second = request.run((signal) => { currentSignal = signal; return current.promise; });
  old.resolve();
  await first;
  request.cancel();
  assert.equal(currentSignal.aborted, true);
  current.resolve();
  await second;
});

test('cleanup cancels requests and permits a new mount after cleanup', async () => {
  const request = createLatestRequest();
  const pending = deferred();
  let signal;
  const result = request.run((next) => { signal = next; return pending.promise; });
  request.cancel();
  request.cancel();
  assert.equal(signal.aborted, true);
  pending.resolve();
  await result;
  await request.run((next) => assert.equal(next.aborted, false));
});

test('a rejected request does not poison the next load', async () => {
  const request = createLatestRequest();
  await assert.rejects(request.run(() => { throw new Error('offline'); }), /offline/);
  assert.equal(await request.run(async () => 'recovered'), 'recovered');
});
