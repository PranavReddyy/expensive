import test from 'node:test';
import assert from 'node:assert/strict';
import {fmt,setCurrency,currencySymbol,currencySymbols} from '../lib/format.js';
test('currency preferences change symbols only, never numeric amounts',()=>{
  for (const [code,symbol] of Object.entries(currencySymbols)) {
    setCurrency(code);
    assert.equal(currencySymbol(),symbol);
    assert.equal(fmt(1234.5),`${symbol}1,234.50`);
    assert.equal(fmt(-5),`${symbol}-5.00`);
  }
  setCurrency('invalid'); assert.equal(currencySymbol(),'₹');
});
