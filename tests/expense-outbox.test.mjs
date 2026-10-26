import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseOutbox} from '../lib/expense-outbox.mjs';
function setup(send) {
 const rows=new Map();let owner='alice';
 const store={get:async key=>rows.get(key),put:async row=>rows.set(row.key,row),remove:async key=>rows.delete(key),list:async owner=>[...rows.values()].filter(r=>r.owner===owner)};
 return {queue:createExpenseOutbox({store,send,isActive:id=>id===owner}),rows,switch:id=>owner=id};
}
test('offline queue persists failures, uses stable IDs and never flushes another owner',async()=>{
 let fail=true;const received=[];
 const context=setup(async(owner,payload)=>{received.push([owner,payload.p_id]);if(fail)throw new Error('offline');});
 await context.queue.enqueue('alice',{p_id:'one',p_amount:10});
 await context.queue.flush('alice');assert.equal(context.rows.size,1);
 context.switch('bob');await context.queue.flush('alice');assert.equal(received.length,1);
 await assert.rejects(context.queue.enqueue('alice',{p_id:'two'}),/Sign in/);
 context.switch('alice');fail=false;await context.queue.flush('alice');assert.equal(context.rows.size,0);
 assert.deepEqual(received,[['alice','one'],['alice','one']]);
});
test('permanent failures wait for explicit retry; concurrent flushes are coalesced',async()=>{
 let calls=0,fail=true;
 const {queue,rows}=setup(async()=>{calls++;if(fail)throw Object.assign(new Error('Category archived'),{permanent:true});});
 await queue.enqueue('alice',{p_id:'one'});await Promise.all([queue.flush('alice'),queue.flush('alice')]);assert.equal(calls,1);
 await queue.flush('alice');assert.equal(calls,1);assert.equal(rows.size,1);
 fail=false;await queue.flush('alice',{retry:true});assert.equal(rows.size,0);
});
test('draft payload cannot be silently changed under a previously used ID',async()=>{
 const {queue}=setup(async()=>{});await queue.enqueue('alice',{p_id:'one',p_amount:10});
 await assert.rejects(queue.enqueue('alice',{p_id:'one',p_amount:20}),/already used/);
});
test('only server-rejected drafts may be discarded; uncertain writes require retry',async()=>{
 const {queue}=setup(async()=>{throw Object.assign(new Error('Rejected'),{permanent:true});});
 await queue.enqueue('alice',{p_id:'one'});
 await assert.rejects(queue.discardRejected('alice','one'),/Retry/);
 await queue.flush('alice');await queue.discardRejected('alice','one');
 assert.deepEqual(await queue.list('alice'),[]);
});
