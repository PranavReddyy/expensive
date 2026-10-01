import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION current_app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.owner',true),'')::uuid $$;`);
await db.exec(await readFile(new URL('./fixtures/legacy-schema.sql', import.meta.url), 'utf8'));
await db.exec(`ALTER TABLE profiles ADD user_id uuid;
INSERT INTO profiles(id,name,balance,user_id) VALUES('${id(10)}','Bank',1000,'${id(1)}'),('${id(11)}','Other',500,'${id(2)}');
INSERT INTO people(id,profile_id,name) VALUES('${id(20)}','${id(10)}','Sam');
GRANT USAGE ON SCHEMA public TO authenticated,anon;`);
const migration = await readFile(new URL('../ios/Database/activity-history.sql', import.meta.url), 'utf8');
await db.exec(migration); await db.exec(migration);
after(() => db.close());
async function asUser(owner, action) {
 await db.query("SELECT set_config('test.owner',$1,false)",[owner || '']);
 await db.exec('SET ROLE authenticated');
 try { return await action(); } finally { await db.exec('RESET ROLE'); }
}
const balance = async () => Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance);
const record = (request,payment,collect,pay) => db.query('SELECT record_tab_payment($1,$2,$3,$4,$5,$6)',[id(request),id(10),id(20),payment,collect,pay]);
const undo = request => db.query('SELECT undo_tab_payment($1)',[id(request)]);
async function setup(collect,pay) {
 await db.exec('DELETE FROM account_activity; DELETE FROM debts; DELETE FROM expenses;');
 await db.exec(`UPDATE profiles SET balance=1000 WHERE id='${id(10)}';`);
 for(const [direction,amount] of [['they_owe_me',collect],['i_owe_them',pay]]) if(amount) await db.query('INSERT INTO debts(profile_id,person_id,direction,amount,remaining_amount,description) VALUES($1,$2,$3,$4,$4,$5)',[id(10),id(20),direction,amount,'Test']);
}
test('balance add/subtract/set are atomic, retry-safe and owner checked',async()=>{
 await asUser(id(1),async()=>{
  for(let i=0;i<2;i++) await db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(30),id(10),'add',100]);
  await assert.rejects(db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(30),id(10),'add',200]),/already used/);
 });
 assert.equal(await balance(),1100);
 await asUser(id(1),()=>db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(31),id(10),'subtract',50]));
 assert.equal(await balance(),1050);
 await asUser(id(1),()=>db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(32),id(10),'set',20]));
 assert.equal(await balance(),20);
 await asUser(id(2),()=>assert.rejects(db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(33),id(10),'add',10]),/Account not found/));
});
test('received payment with offsets can be retried and undone exactly once',async()=>{
 await setup(100,20);
 await asUser(id(1),async()=>{ await record(40,50,100,20); await record(40,50,100,20); });
 assert.equal(await balance(),1050);
 await asUser(id(1),async()=>{ await undo(40); await undo(40); });
 assert.equal(await balance(),1000);
 assert.equal(Number((await db.query('SELECT sum(remaining_amount) AS total FROM debts')).rows[0].total),120);
 await asUser(id(1),()=>record(40,50,100,20)); // old retry must not reapply undone payment
 assert.equal(await balance(),1000);
});
test('outgoing payment undo removes only its generated expense and restores debts',async()=>{
 await setup(20,100);
 await asUser(id(1),()=>record(41,80,20,100));
 assert.equal(await balance(),920);
 assert.equal((await db.query('SELECT * FROM expenses')).rows.length,1);
 await asUser(id(1),()=>undo(41));
 assert.equal(await balance(),1000);
 assert.equal((await db.query('SELECT * FROM expenses')).rows.length,0);
});
test('later payment blocks older undo until the later one is undone',async()=>{
 await setup(100,0);
 await asUser(id(1),async()=>{
  await record(42,30,100,0); await record(43,20,70,0);
  await assert.rejects(undo(42),/changed/);
  await undo(43); await undo(42);
 });
 assert.equal(await balance(),1000);
});
test('edited or deleted expense blocks undo without partial changes',async()=>{
 await setup(0,100); await asUser(id(1),()=>record(44,100,0,100));
 await db.exec("UPDATE expenses SET notes='edited'");
 await asUser(id(1),()=>assert.rejects(undo(44),/expense was changed/));
 assert.equal(await balance(),900);
 assert.equal(Number((await db.query('SELECT sum(remaining_amount) AS total FROM debts')).rows[0].total),0);
 await db.exec('DELETE FROM expenses');
 await asUser(id(1),()=>assert.rejects(undo(44),/expense was changed/));
 assert.equal(await balance(),900);
});
test('undo preserves unrelated later balance adjustments',async()=>{
 await setup(100,0);
 await asUser(id(1),async()=>{
  await record(60,100,100,0);
  await db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(61),id(10),'add',50]);
  await undo(60);
 });
 assert.equal(await balance(),1050);
});
test('invalid amounts and anonymous requests cannot change money',async()=>{
 await setup(100,0);
 await asUser(id(1),async()=>{
  for(const amount of [-1,0,1.001,'NaN','Infinity']) {
   await assert.rejects(db.query('SELECT adjust_balance($1,$2,$3,$4)',[id(70),id(10),'add',amount]));
  }
  await assert.rejects(record(71,101,100,0));
  await assert.rejects(record(71,10,99,0),/changed/);
 });
 await db.exec('SET ROLE anon');
 try { await assert.rejects(record(72,10,100,0),/permission denied/); }
 finally { await db.exec('RESET ROLE'); }
 assert.equal(await balance(),1000);
});
test('zero-net clearing is reversible; foreign users cannot read, mutate or undo history',async()=>{
 await setup(50,50); await asUser(id(1),()=>record(45,0,50,50));
 await asUser(id(2),async()=>{
  assert.equal((await db.query('SELECT * FROM account_activity')).rows.length,0);
  await assert.rejects(undo(45),/not found/);
  await assert.rejects(record(46,0,0,0),/Account not found/);
 });
 await asUser(id(1),async()=>{
  await assert.rejects(db.exec('DELETE FROM account_activity'),/permission denied/);
  await undo(45);
 });
 assert.equal(await balance(),1000);
 assert.equal(Number((await db.query('SELECT sum(remaining_amount) AS total FROM debts')).rows[0].total),100);
});
