import test from 'node:test';
import assert from 'node:assert/strict';
import {amountValue,validAmount} from '../lib/amount.mjs';
import {splitTripAmount} from '../lib/trips.mjs';
import {customSplit,splitAmount} from '../lib/tabs.mjs';

test('amount calculations respect precedence, parentheses and unary signs',()=>{
 for(const [text,result] of [['=120+80',200],['=120+80/2',160],['=(120+80)/2',100],['=10-3*2',4],['=2×3÷4',1.5],['= -5 + +2',-3],['=10/-2',-5],['=.5+1.5',2],['=0.1+0.2',0.3],['=1/3',0.33],['=1.005',1.01],['=-1.005',-1.01],['=1/3*3',1],[' 12.30 ',12.3]]) assert.equal(amountValue(text),result,text);
});
test('invalid, incomplete, unsafe or oversized calculations cannot become money',()=>{
 for(const text of ['', '=', '=2+', '=1/0', '=0/0', '=2(3)', '=Math.random()', '=alert(1)', '=2**3', '=1e3', '=()', '=1 2', '=2+3)', '=10000000000', '=9999999999.999', '1+2','1.234','Infinity',null,'='.repeat(300)]) assert.ok(Number.isNaN(amountValue(text)),String(text));
 assert.equal(validAmount('=-2'),false);
 assert.equal(validAmount('=-2',true),true);
});
test('calculated totals and custom shares feed the existing split logic',()=>{
 assert.deepEqual(splitTripAmount('=50*2',['me','a'],{me:'=20+10',a:''}),{me:30,a:70});
 assert.deepEqual(customSplit('=100/2',['=10+5',''],true),{amounts:[15],ownShare:35});
 assert.deepEqual(splitAmount('=20*2',1,true),{amounts:[20],ownShare:20});
});
