import test from 'node:test';
import assert from 'node:assert/strict';
import { periodInsights,projectedBalance } from '../lib/period-insights.mjs';
const date = day => new Date(2026,8,day,12);
test('period insights exclude future and out-of-period spending; today is not a completed no-spend day',()=>{
  const start = new Date(2026,8,1), end = new Date(2026,9,1);
  const rows = [1,1,3,7,31].map((day,index)=>({id:index,created_at:date(day).toISOString(),amount:10}));
  const result = periodInsights(rows,start,end,date(5));
  assert.equal(result.total,30); assert.equal(result.rows.length,3);
  assert.equal(result.noSpendDays,2); assert.equal(result.dailyAverage,6); assert.equal(result.projected,180);
  assert.equal(projectedBalance(1000,30,180),850);
});
test('historical leap month has no forecast and counts all completed days',()=>{
  const result=periodInsights([],new Date(2024,1,1),new Date(2024,2,1),new Date(2024,3,1));
  assert.equal(result.noSpendDays,29); assert.equal(result.projected,null);
  assert.equal(projectedBalance(100,20,null),100);
});
