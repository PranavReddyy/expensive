import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { passwordLogin, limitPublicAuth } from '../lib/identity/public-auth.mjs';
import { reserveEmailBudget } from '../lib/identity/email-budget.mjs';

function database(initial = []) {
  const docs = new Map(initial);
  const snapshot = key => ({ exists: docs.has(key), data: () => docs.get(key) });
  let queue = Promise.resolve();
  return { docs, collection: name => ({ doc: id => ({ key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
    runTransaction(action) {
      const task = queue.then(() => action({ get: async ref => snapshot(ref.key), set: (ref, value) => docs.set(ref.key, value) }));
      queue = task.catch(() => {}); return task;
    } };
}
function loginFixture(overrides = {}) {
  const calls = [];
  const args = { db: database([['usernames/pranav', { uid: 'uid-1' }]]), apiKey: 'test-key',
    identifier: 'Pranav', password: 'correct-password',
    auth: { getUser: async uid => ({ uid, email: 'owner@example.com' }), createCustomToken: async uid => { calls.push(uid); return 'custom'; } },
    fetcher: async (url, request) => {
      assert.equal(JSON.parse(request.body).email, 'owner@example.com');
      return Response.json({ idToken: 'id', refreshToken: 'refresh', localId: 'uid-1' });
    }, ...overrides };
  return { args, calls };
}
test('Firebase Admin loads when the server runtime disables require(esm)', () => {
  execFileSync(process.execPath, ['--no-experimental-require-module', '-e', "require('firebase-admin/auth')"], { env: { ...process.env, NODE_OPTIONS: '' } });
});
test('username and email login only return a token after successful password verification', async () => {
  for (const identifier of [' Pranav ', 'owner@example.com']) {
    const { args, calls } = loginFixture({ identifier });
    assert.deepEqual(await passwordLogin(args), { customToken: 'custom' });
    assert.deepEqual(calls, ['uid-1']);
  }
});
test('missing names and incorrect credentials have the same error and never mint tokens', async () => {
  for (const overrides of [ { identifier: 'unknown' }, { identifier: '../invalid' }, { password: '' },
    { fetcher: async () => Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 }) },
    { fetcher: async () => Response.json({ mfaPendingCredential: 'challenge' }) } ]) {
    const { args, calls } = loginFixture(overrides);
    await assert.rejects(passwordLogin(args), { status: 401, message: 'Username, email, or password is incorrect.' });
    assert.deepEqual(calls, []);
  }
});
test('disabled users cannot get a custom token', async () => {
  const { args, calls } = loginFixture();
  args.auth.getUser = async () => ({ disabled: true, email: 'owner@example.com' });
  await assert.rejects(passwordLogin(args), { status: 401 }); assert.deepEqual(calls, []);
});
test('public auth endpoints share a durable request limit', async () => {
  const db = database(); const request = new Request('https://example.com');
  await limitPublicAuth(db, request, 'test', 1);
  await assert.rejects(limitPublicAuth(db, request, 'test', 1), { status: 429 });
});
test('email rejection refunds the reservation exactly once and allows an immediate retry', async () => {
  const db = database(); const now = Date.now();
  const refund = await reserveEmailBudget(db, 'verify', 'owner@example.com', 1, now);
  assert.equal(typeof refund, 'function');
  assert.equal(await reserveEmailBudget(db, 'verify', 'owner@example.com', 1, now + 1), null);
  await refund(); await refund();
  const retry = await reserveEmailBudget(db, 'verify', 'owner@example.com', 1, now + 2);
  assert.equal(typeof retry, 'function');
  await refund();
  assert.equal(await reserveEmailBudget(db, 'verify', 'other@example.com', 1, now + 3), null);
});
test('email limits preserve the five-per-hour limit and reset after the window', async () => {
  const db = database(); const now = Date.now();
  for (let i = 0; i < 5; i++) assert.equal(typeof await reserveEmailBudget(db, 'verify', 'owner@example.com', 90, now + i * 61000), 'function');
  assert.equal(await reserveEmailBudget(db, 'verify', 'owner@example.com', 90, now + 5 * 61000), null);
  assert.equal(typeof await reserveEmailBudget(db, 'verify', 'owner@example.com', 90, now + 3600001), 'function');
});
