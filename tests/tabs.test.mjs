import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTabs, splitAmount } from '../lib/tabs.mjs';

test('aggregates people in both directions without treating offset debts as settled', () => {
  const result = summarizeTabs([
    { person_id:'a', direction:'they_owe_me', remaining_amount:'125.10' },
    { person_id:'a', direction:'they_owe_me', remaining_amount:'74.90' },
    { person_id:'a', direction:'i_owe_them', remaining_amount:'200.00' },
    { person_id:'b', direction:'i_owe_them', remaining_amount:'30.00' },
    { person_id:'b', direction:'they_owe_me', remaining_amount:'0' },
  ]);
  assert.equal(result.collect, 200);
  assert.equal(result.pay, 230);
  assert.equal(result.people.get('a').entries.length, 3);
  assert.equal(result.people.get('a').collect, result.people.get('a').pay);
  assert.equal(1000 + result.collect - result.pay, 970);
});
test('split preserves every paise with and without an own share', () => {
  assert.deepEqual(splitAmount('100', 2, true), { amounts:[33.34,33.33], ownShare:33.33 });
  assert.deepEqual(splitAmount('100', 3, false), { amounts:[33.34,33.33,33.33], ownShare:0 });
  assert.deepEqual(splitAmount('0.03', 2, true), { amounts:[0.01,0.01], ownShare:0.01 });
  assert.throws(() => splitAmount('0.01', 2, true));
});
