import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername } from '../lib/identity/username.mjs';
import { reserveUsername } from '../lib/identity/reserve-username.mjs';

// Transactional in-memory adapter verifies reservation behavior. Firestore's
// concurrency guarantees are provided by its server transactions in production.
function store() {
  const docs = new Map(); let queue = Promise.resolve();
  return { docs, collection: name => ({ doc: key => `${name}/${key}` }),
    runTransaction(fn) {
      const next = queue.then(async () => {
        const writes = [];
        const result = await fn({ get: async key => ({ exists: docs.has(key), data: () => docs.get(key) }),
          create: (key,value) => { assert.equal(docs.has(key),false); writes.push([key,value]); } });
        for(const [key,value] of writes) docs.set(key,value);
        return result;
      });
      queue = next.catch(()=>{}); return next;
    },
  };
}
test('username normalization is canonical and rejects paths, unicode confusables, reserved names and invalid lengths',()=>{
  assert.equal(normalizeUsername(' Pranav_123 '),'pranav_123');
  for(const value of ['ab','a'.repeat(25),'1pranav','Admin','a/b','a.b','prаnav','root',null,{},'']) assert.throws(()=>normalizeUsername(value));
});
test('competing case variants reserve one username; retry is idempotent and cannot steal or rename',async()=>{
  const db=store();
  const results=await Promise.allSettled([reserveUsername(db,'first','Pranav'),reserveUsername(db,'second','pranav')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.docs.get('usernames/pranav').uid,'first');
  await reserveUsername(db,'first','PRANAV');
  assert.equal(db.docs.size,2);
  await assert.rejects(reserveUsername(db,'first','different'),/already has/);
  await assert.rejects(reserveUsername(db,'second','Pranav'),/already taken/);
  assert.equal(db.docs.size,2);
});
