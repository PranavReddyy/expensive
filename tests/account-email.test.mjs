import test from 'node:test';
import assert from 'node:assert/strict';
import { brandedActionLink, accountEmail, readEmailAction } from '../lib/identity/account-email.mjs';

const base = 'https://expensive.itsbypranav.com';
for (const [kind, mode] of [['verify', 'verifyEmail'], ['reset', 'resetPassword']]) {
  test(`${kind}: custom domain, original single-use code, branded HTML and text`, () => {
    const generated = `https://project.firebaseapp.com/__/auth/action?mode=${mode}&oobCode=one_time-code&apiKey=public-key&continueUrl=https://unwanted.example`;
    const link = brandedActionLink(generated, kind, base);
    const parsed = new URL(link);
    assert.equal(parsed.origin, base);
    assert.equal(parsed.pathname, '/auth/action');
    assert.equal(parsed.search, '');
    assert.deepEqual(readEmailAction(link), { mode, code: 'one_time-code' });
    const message = accountEmail(kind, link);
    assert.match(message.html, /EXPENS\*\*\*/);
    assert.match(message.text, /EXPENS\*\*\*/);
    assert.ok(message.text.includes(link));
    assert.ok(message.html.includes(base + '/auth/action#'));
    assert.ok(!JSON.stringify(message).match(/firebaseapp|apiKey|continueUrl|unwanted\.example/));
    assert.equal((message.html.match(/href=/g) || []).length, 2);
    assert.match(message.html, /&amp;oobCode=/);
  });
}
test('legacy query links remain supported', () => {
  assert.deepEqual(readEmailAction(base + '/auth/action?mode=verifyEmail&oobCode=old'), { mode: 'verifyEmail', code: 'old' });
});
test('missing codes, mismatched actions and unsafe destination URLs fail closed', () => {
  const source = 'https://project.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=valid';
  for (const target of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) {
    assert.throws(() => brandedActionLink(source, 'verify', target));
  }
  assert.throws(() => brandedActionLink(source, 'reset', base));
  assert.throws(() => brandedActionLink(source.replace('&oobCode=valid', ''), 'verify', base));
  assert.throws(() => accountEmail('other', source));
  assert.ok(brandedActionLink(source, 'verify', 'http://localhost:3000').startsWith('http://localhost:3000/auth/action#'));
});
