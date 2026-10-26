import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {splitTripAmount,equalTripShares,tripStatistics} from '../lib/trips.mjs';
const db=new PGlite();after(()=>db.close());const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA app_private;
CREATE TABLE app_private.app_accounts(id uuid PRIMARY KEY);CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
CREATE FUNCTION public.current_app_user_id() RETURNS uuid LANGUAGE sql AS $$SELECT auth.uid()$$;`);
await db.exec(await readFile(new URL('./fixtures/legacy-schema.sql',import.meta.url),'utf8'));
await db.exec(`ALTER TABLE profiles ADD user_id uuid;ALTER TABLE categories ADD user_id uuid;
INSERT INTO app_private.app_accounts VALUES('${id(1)}'),('${id(2)}');
INSERT INTO profiles(id,name,balance,user_id) VALUES('${id(10)}','Mine',1000,'${id(1)}'),('${id(11)}','Other',500,'${id(2)}');
INSERT INTO people(id,profile_id,name) VALUES('${id(20)}','${id(10)}','Friend'),('${id(21)}','${id(11)}','Other friend');
GRANT USAGE ON SCHEMA auth TO authenticated;`);
await db.exec(await readFile(new URL('../supabase-trips.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase-trip-editing.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase-trip-deletion.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase-trip-budgets.sql',import.meta.url),'utf8'));
async function asUser(owner,fn){await db.query("SELECT set_config('test.owner',$1,false)",[owner]);await db.exec('SET ROLE authenticated');try{return await fn()}finally{await db.exec('RESET ROLE')}}
test('personal budgets save independently, validate and preserve balances and old-client edits',async()=>{
 const balances=(await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows;
 const args=[id(90),id(10),'Budget test',500,120,'2026-10-18','2026-10-20',[id(20)]];
 await asUser(id(1),async()=>{
  await db.query('SELECT save_trip_budgets($1,$2,$3,$4,$5,$6,$7,$8)',args);
  for(const invalid of [-1,0.001,10000000000,null])await assert.rejects(db.query('SELECT save_trip_budgets($1,$2,$3,$4,$5,$6,$7,$8)',args.map((v,i)=>i===4?invalid:v)),/personal budget/);
  await db.query('SELECT save_trip($1,$2,$3,$4,$5,$6,$7)',[id(90),id(10),'Legacy edit',600,'2026-10-18','2026-10-20',[id(20)]]);
 });
 await asUser(id(2),()=>assert.rejects(db.query('SELECT save_trip_budgets($1,$2,$3,$4,$5,$6,$7,$8)',args),/not found/));
 const trip=(await db.query('SELECT budget,personal_budget FROM trips WHERE id=$1',[id(90)])).rows[0];
 assert.equal(Number(trip.budget),600);assert.equal(Number(trip.personal_budget),120);
 assert.deepEqual((await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows,balances);
 await asUser(id(1),()=>db.query('SELECT delete_trip($1)',[id(90)]));
});
test('equal and custom splits preserve cents and calculate one missing share',()=>{
 assert.equal(equalTripShares(10,{me:3.34,a:3.33,b:3.33}),true);
 assert.equal(equalTripShares(10,{me:3,a:7}),false);
 assert.equal(equalTripShares(10,{}),false);
 assert.deepEqual(tripStatistics([{amount:20},{amount:40}],'2026-10-18','2026-10-20'),{count:2,days:3,daily:20,largest:40});
 assert.deepEqual(splitTripAmount('10',['me','a','b']),{me:3.34,a:3.33,b:3.33});
 assert.deepEqual(splitTripAmount('10',['me','a'],{me:'3',a:''}),{me:3,a:7});
 assert.throws(()=>splitTripAmount('10',['me','a'],{me:'11',a:''}));
 assert.throws(()=>splitTripAmount('10',['me','a'],{}));
});
test('private trips record own spending and receivables once, without double deduction',async()=>{
 await asUser(id(1),async()=>{
  await db.query('SELECT save_trip($1,$2,$3,$4,$5,$6,$7)',[id(30),id(10),'Holiday',500,'2026-10-15','2026-10-20',[id(20)]]);
  const record=()=>db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(40),id(30),'Dinner',100,null,{me:40,[id(20)]:60},null]);
  await record();await record();
  await assert.rejects(db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(41),id(30),'Invalid',100,null,{me:40,[id(21)]:60},null]),/participants/);
 });
 assert.equal(Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance),900);
 assert.equal(Number((await db.query('SELECT sum(amount) amount FROM expenses')).rows[0].amount),40);
 assert.equal(Number((await db.query('SELECT sum(remaining_amount) amount FROM debts')).rows[0].amount),60);
});
test('someone else paying records only my payable, and cross-user access is rejected',async()=>{
 await asUser(id(1),()=>db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(42),id(30),'Taxi',90,id(20),{me:30,[id(20)]:60},null]));
 assert.equal(Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance),900);
 assert.equal(Number((await db.query("SELECT sum(remaining_amount) amount FROM debts WHERE direction='i_owe_them'")).rows[0].amount),30);
 await asUser(id(2),async()=>{
  assert.equal((await db.query('SELECT * FROM trips')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM trip_entries')).rows.length,0);
  await assert.rejects(db.query('SELECT complete_trip($1,true)',[id(30)]),/not found/);
 });
 await asUser(id(1),async()=>{
  await db.query('SELECT complete_trip($1,true)',[id(30)]);
  await assert.rejects(db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(43),id(30),'Late',10,null,{me:10},null]),/Reopen/);
 });
});
test('trip editing adjusts balances and shares atomically, with retry and version protection',async()=>{
 await asUser(id(1),async()=>{
  await db.query('SELECT complete_trip($1,false)',[id(30)]);
  const edit=()=>db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(60),id(40),1,'Dinner updated',120,null,{me:50,[id(20)]:70},null]);
  await edit();await edit();
  await assert.rejects(db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(61),id(40),1,'Stale',200,null,{me:200},null]),/changed/);
  await assert.rejects(db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(62),id(40),2,'Invalid',120,null,{me:500},null]),/Invalid split/);
 });
 assert.equal(Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance),880);
 assert.equal(Number((await db.query('SELECT sum(amount) amount FROM expenses')).rows[0].amount),50);
 assert.equal((await db.query('SELECT * FROM trip_entries')).rows.length,2);
 await asUser(id(2),()=>assert.rejects(db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(63),id(40),2,'Stolen',100,null,{me:100},null]),/not found/));
 await asUser(id(1),()=>db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(64),id(40),2,'Friend paid',120,id(20),{me:50,[id(20)]:70},null]));
 assert.equal(Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance),1000);
 assert.equal((await db.query('SELECT * FROM expenses')).rows.length,0);
 await db.exec(`UPDATE debts SET remaining_amount=remaining_amount-1 WHERE id=(SELECT (ledger_debts->0->>'id')::uuid FROM trip_entries WHERE id='${id(40)}')`);
 await asUser(id(1),()=>assert.rejects(db.query('SELECT edit_trip_expense($1,$2,$3,$4,$5,$6,$7,$8)',[id(65),id(40),3,'Settled edit',100,null,{me:100},null]),/Related expenses or Tabs changed/));
 // A delayed original create remains a no-op after edits.
 await asUser(id(1),()=>db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(40),id(30),'Dinner',100,null,{me:40,[id(20)]:60},null]));
 assert.equal(Number((await db.query(`SELECT balance FROM profiles WHERE id='${id(10)}'`)).rows[0].balance),1000);
});
test('legacy link backfill preserves balances and skips changed debts',async()=>{
 await db.exec('UPDATE trip_entries SET ledger_expenses=NULL,ledger_debts=NULL');
 const before=(await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows;
 await db.exec(await readFile(new URL('../supabase-trip-editing.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows,before);
 const changed=(await db.query('SELECT ledger_debts FROM trip_entries WHERE id=$1',[id(40)])).rows[0];
 const untouched=(await db.query('SELECT ledger_debts FROM trip_entries WHERE id=$1',[id(42)])).rows[0];
 assert.equal(changed.ledger_debts,null);
 assert.equal(untouched.ledger_debts.length,1);
});

test('trip expense deletion reverses only its own money once and protects stale/changed records',async()=>{
 const balance=Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[id(10)])).rows[0].balance);
 await asUser(id(1),async()=>{
  await db.query('SELECT save_trip($1,$2,$3,$4,$5,$6,$7)',[id(70),id(10),'Delete test',500,'2026-10-18','2026-10-20',[id(20)]]);
  await db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(71),id(70),'Bill',100,null,{me:40,[id(20)]:60},null]);
  await assert.rejects(db.query('SELECT delete_trip_expense($1,$2)',[id(71),2]),/changed/);
 });
 await asUser(id(2),()=>assert.rejects(db.query('SELECT delete_trip_expense($1,$2)',[id(71),1]),/not found/));
 await db.query('UPDATE debts SET remaining_amount=59 WHERE trip_id=$1',[id(70)]);
 await asUser(id(1),()=>assert.rejects(db.query('SELECT delete_trip_expense($1,$2)',[id(71),1]),/Related/));
 assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[id(10)])).rows[0].balance),balance-100);
 await db.query('UPDATE debts SET remaining_amount=60 WHERE trip_id=$1',[id(70)]);
 await asUser(id(1),async()=>{
  await db.query('SELECT delete_trip_expense($1,$2)',[id(71),1]);
  await db.query('SELECT delete_trip_expense($1,$2)',[id(71),1]);
  await assert.rejects(db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(71),id(70),'Bill',100,null,{me:40,[id(20)]:60},null]),/deleted/);
 });
 assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[id(10)])).rows[0].balance),balance);
 assert.equal((await db.query('SELECT * FROM expenses WHERE trip_id=$1',[id(70)])).rows.length,0);
 assert.equal((await db.query('SELECT * FROM debts WHERE trip_id=$1',[id(70)])).rows.length,0);
});
test('trip deletion keeps financial amounts and blocks delayed recreation',async()=>{
 await asUser(id(1),()=>db.query('SELECT add_trip_expense($1,$2,$3,$4,$5,$6,$7)',[id(72),id(70),'Keep financial history',100,null,{me:40,[id(20)]:60},null]));
 const before=(await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows;
 const es=(await db.query('SELECT id,amount FROM expenses WHERE trip_id=$1',[id(70)])).rows;
 const ds=(await db.query('SELECT id,remaining_amount FROM debts WHERE trip_id=$1',[id(70)])).rows;
 await asUser(id(2),()=>assert.rejects(db.query('SELECT delete_trip($1)',[id(70)]),/not found/));
 await asUser(id(1),async()=>{
  await db.query('SELECT delete_trip($1)',[id(70)]); await db.query('SELECT delete_trip($1)',[id(70)]);
  await assert.rejects(db.query('SELECT save_trip($1,$2,$3,$4,$5,$6,$7)',[id(70),id(10),'Retry',500,'2026-10-18','2026-10-20',[id(20)]]),/deleted/);
 });
 assert.deepEqual((await db.query('SELECT id,balance FROM profiles ORDER BY id')).rows,before);
 assert.equal((await db.query('SELECT * FROM trip_entries WHERE trip_id=$1',[id(70)])).rows.length,0);
 assert.equal(Number((await db.query('SELECT amount FROM expenses WHERE id=$1',[es[0].id])).rows[0].amount),Number(es[0].amount));
 assert.equal(Number((await db.query('SELECT remaining_amount FROM debts WHERE id=$1',[ds[0].id])).rows[0].remaining_amount),Number(ds[0].remaining_amount));
});
