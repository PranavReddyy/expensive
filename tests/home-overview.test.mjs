import test from 'node:test';
import assert from 'node:assert/strict';
import { homeOverview } from '../lib/home-overview.mjs';

test('seven-day overview crosses month boundaries without including old spending in month totals', () => {
  const now = new Date(2026, 8, 2, 12);
  const expense = (day, amount, name) => ({ created_at: new Date(2026, 8, day, 10).toISOString(), amount, categories: name ? { name } : null });
  const result = homeOverview([expense(0, 90, 'food'), expense(1, '20', 'food'), expense(2, 30), expense(3, 500, 'future')], now);
  assert.equal(result.days.length, 7);
  assert.equal(result.days.reduce((sum, day) => sum + day.amount, 0), 140);
  assert.equal(result.month, 50);
  assert.equal(result.today, 30);
  assert.equal(result.count, 2);
  assert.deepEqual(result.top, [['uncategorized', 30], ['food', 20]]);
});

test('empty overview has seven zero days and no top categories', () => {
  const result = homeOverview([], new Date(2026, 8, 1));
  assert.equal(result.month, 0);
  assert.equal(result.today, 0);
  assert.equal(result.days.length, 7);
  assert.ok(result.days.every(day => day.amount === 0));
  assert.deepEqual(result.top, []);
});
