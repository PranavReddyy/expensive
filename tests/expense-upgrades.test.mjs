import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION current_app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.owner',true),'')::uuid $$;`);
await db.exec(await readFile(new URL('./fixtures/legacy-schema.sql',import.meta.url),'utf8'));
await db.exec(`ALTER TABLE profiles ADD user_id uuid; ALTER TABLE categories ADD user_id uuid;
INSERT INTO profiles(id,name,balance,user_id) VALUES('${id(10)}','Bank',1000,'${id(1)}'),('${id(11)}','Other',500,'${id(2)}');
INSERT INTO categories(id,name,user_id) VALUES('${id(20)}','Food','${id(1)}'),('${id(21)}','Private','${id(2)}');
GRANT USAGE ON SCHEMA public TO authenticated,anon;`);
await db.exec(await readFile(new URL('../ios/Database/activity-history.sql',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase-expense-upgrades.sql',import.meta.url),'utf8');
await db.exec(migration); await db.exec(migration);
after(()=>db.close());
async function asUser(owner, action) {
 await db.query("SELECT set_config('test.owner',$1,false)",[id(owner)]);
 await db.exec('SET ROLE authenticated');
 try { return await action(); } finally { await db.exec('RESET ROLE'); }
}
const balance=async()=>Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance);
const create=(n,category=id(20))=>db.query('SELECT ios_add_expense($1,$2,$3,$4,$5,$6,$7)',[id(n),id(10),'Lunch',10,'','2026-01-01T12:00:00Z',category]);
test('creation is owner checked, atomic, retry safe and cannot resurrect a deleted expense',async()=>{
 await asUser(2,()=>assert.rejects(create(30),/Account not found/));
 await asUser(1,()=>assert.rejects(create(30,id(21)),/available category/));
 await asUser(1,async()=>{ await create(30); await create(30); });
 assert.equal(await balance(),990);
 await db.exec(`DELETE FROM expenses WHERE id='${id(30)}'; UPDATE profiles SET balance=1000 WHERE id='${id(10)}'`);
 await asUser(1,()=>create(30));
 assert.equal(await balance(),1000);
 assert.equal((await db.query(`SELECT * FROM expenses WHERE id='${id(30)}'`)).rows.length,0);
});
test('edits apply only the difference and reject stale versions and reused requests',async()=>{
 await asUser(1,()=>create(31));
 const edit=(request,version,amount)=>db.query('SELECT edit_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(request),id(31),version,'Dinner',amount,'Note','2026-01-02T12:00:00Z',id(20)]);
 await asUser(2,()=>assert.rejects(edit(40,1,25),/no longer exists/));
 await asUser(1,async()=>{
  await edit(40,1,25); await edit(40,1,25);
  await assert.rejects(edit(40,1,30),/already used/);
  await assert.rejects(edit(41,1,30),/changed/);
 });
 assert.equal(await balance(),975);
 assert.equal(Number((await db.query(`SELECT version FROM expenses WHERE id='${id(31)}'`)).rows[0].version),2);
});
test('recurring review records once, preserves month-end anchor and supports skip/pause',async()=>{
 const createRule=()=>db.query('SELECT add_recurring_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(50),id(10),'Rent',100,null,'','monthly','2024-01-31']);
 const review=(due,action='record')=>db.query('SELECT review_recurring_expense($1,$2,$3,$4)',[id(50),due,action,`${due}T12:00:00Z`]);
 await asUser(1,async()=>{await createRule();await createRule();});
 const before=await balance();
 await asUser(2,()=>assert.rejects(review('2024-01-31'),/not found/));
 await asUser(1,async()=>{await review('2024-01-31');await review('2024-01-31');});
 assert.equal(await balance(),before-100);
 const next=async()=>String((await db.query(`SELECT next_due::text FROM recurring_expenses WHERE id='${id(50)}'`)).rows[0].next_due);
 assert.equal(await next(),'2024-02-29');
 await asUser(1,()=>review('2024-02-29','skip'));
 assert.equal(await next(),'2024-03-31');
 assert.equal(await balance(),before-100);
 await asUser(1,async()=>{
  await db.query('SELECT pause_recurring_expense($1,true)',[id(50)]);
  await assert.rejects(review('2024-03-31'),/changed/);
  await assert.rejects(review('2024-02-29'),/already reviewed/);
  await assert.rejects(db.query('SELECT * FROM expense_requests'),/permission denied/);
 });
});
test('category updates cannot target other owners and archived categories reject new expenses',async()=>{
 await asUser(2,()=>assert.rejects(db.query('SELECT save_category($1,$2,$3,$4)',[id(20),'Stolen',2,false]),/not found/));
 await asUser(1,async()=>{
  await db.query('SELECT save_category($1,$2,$3,$4)',[id(20),'Meals',2,true]);
  await assert.rejects(create(32),/available category/);
  await db.query('SELECT save_category($1,$2,$3,$4)',[id(20),'Meals',1,false]);
  await create(32);
 });
});
test('a recurring occurrence cannot be charged again after its expense is deleted',async()=>{
 const before=await balance();
 await asUser(1,async()=>{
  await db.query('SELECT add_recurring_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(51),id(10),'Weekly',7,null,'','weekly','2024-01-01']);
  await db.query('SELECT review_recurring_expense($1,$2,$3,$4)',[id(51),'2024-01-01','record','2024-01-01T12:00:00Z']);
 });
 const occurrence=(await db.query('SELECT expense_id FROM recurring_occurrences WHERE rule_id=$1',[id(51)])).rows[0];
 await db.query('DELETE FROM expenses WHERE id=$1',[occurrence.expense_id]);
 await db.query('UPDATE profiles SET balance=balance+7 WHERE id=$1',[id(10)]);
 await asUser(1,()=>db.query('SELECT review_recurring_expense($1,$2,$3,$4)',[id(51),'2024-01-01','record','2024-01-01T12:00:00Z']));
 assert.equal(await balance(),before);
 assert.equal((await db.query('SELECT * FROM expenses WHERE id=$1',[occurrence.expense_id])).rows.length,0);
});
test('legacy payment snapshots remain undoable after adding expense versions',async()=>{
 await db.query('INSERT INTO people(id,profile_id,name) VALUES($1,$2,$3)',[id(60),id(10),'Friend']);
 await db.query("INSERT INTO debts(profile_id,person_id,direction,amount,remaining_amount,description) VALUES($1,$2,'i_owe_them',15,15,'Test')",[id(10),id(60)]);
 const before=await balance();
 await asUser(1,()=>db.query('SELECT record_tab_payment($1,$2,$3,$4,$5,$6)',[id(61),id(10),id(60),15,0,15]));
 await db.query("UPDATE account_activity SET payment_expense=payment_expense-'version' WHERE id=$1",[id(61)]);
 await db.exec(migration);
 await asUser(1,()=>db.query('SELECT undo_tab_payment($1)',[id(61)]));
 assert.equal(await balance(),before);
});
