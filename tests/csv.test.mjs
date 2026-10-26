import test from 'node:test';
import assert from 'node:assert/strict';
import {csvValue,toCSV} from '../lib/csv.mjs';
test('CSV preserves quotes and newlines and neutralizes formula-like text',()=>{
 assert.equal(csvValue('a,"b"\nc'),'"a,""b""\nc"');
 for(const value of ['=SUM(1,2)','+cmd','-1+2','@x',' \t=1'])assert.equal(csvValue(value),`"'${value}"`);
 assert.equal(toCSV([{reason:'food',amount:10}],['reason','amount']),'\uFEFF"reason","amount"\r\n"food","10"');
});
