import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated fixture: never connects to the production database.
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
 CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,balance numeric);
 CREATE TABLE expenses(id uuid PRIMARY KEY,profile_id uuid REFERENCES profiles(id),
 reason text,amount numeric,notes text,created_at timestamptz,category_id uuid);
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
 ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own ON profiles FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
 CREATE POLICY own ON expenses FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM profiles WHERE id=profile_id))
 WITH CHECK(EXISTS(SELECT 1 FROM profiles WHERE id=profile_id));
 GRANT SELECT,INSERT,UPDATE,DELETE ON profiles,expenses TO authenticated;
 -- Stand-in for the existing add_tab: verifies wrapper idempotency and rollback.
 CREATE FUNCTION add_tab(p_profile uuid,p_rows jsonb,p_own_share numeric) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 UPDATE profiles SET balance=balance-p_own_share WHERE id=p_profile;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 IF p_own_share<0 THEN RAISE EXCEPTION 'Invalid share'; END IF;
 END $$;
 INSERT INTO auth.users VALUES('${id(1)}'),('${id(2)}');
 INSERT INTO profiles VALUES('${id(10)}','${id(1)}',1000),('${id(11)}','${id(1)}',500),('${id(12)}','${id(2)}',700);
`);
await db.exec(await readFile(new URL('./native-operations.sql', import.meta.url), 'utf8'));
after(() => db.close());
async function asUser(user, fn) {
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user || '']);
 await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`);
 try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
async function balance(profile) {
 return Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[profile])).rows[0].balance);
}
const add = (expense, profile, amount=25) => db.query(
 "SELECT ios_add_expense($1,$2,'Lunch',$3,'','2026-09-29T12:00:00Z',NULL)",[expense,profile,amount]);

test('expense add and retry charge once; changed duplicate is rejected', async () => {
 await asUser(id(1), async () => {
  await add(id(30),id(10)); await add(id(30),id(10));
  assert.equal(await balance(id(10)),975);
  await assert.rejects(add(id(30),id(10),30), /already used/);
  assert.equal(await balance(id(10)),975);
 });
});
test('move and retry conserve total; deletion refunds only once', async () => {
 await asUser(id(1),async () => {
  const move=()=>db.query('SELECT ios_move_expense($1,$2,$3)',[id(30),id(10),id(11)]);
  await move(); await move();
  assert.equal(await balance(id(10)),1000); assert.equal(await balance(id(11)),475);
  await db.query('SELECT ios_delete_expense($1)',[id(30)]);
  await db.query('SELECT ios_delete_expense($1)',[id(30)]);
  assert.equal(await balance(id(11)),500);
 });
});
test('foreign accounts and anonymous callers cannot mutate balances', async () => {
 await asUser(id(2),async () => {
  await assert.rejects(add(id(31),id(10)),/Account not found/);
  await assert.rejects(db.query('SELECT ios_move_expense($1,$2,$3)',[id(30),id(10),id(12)]),/Account not found/);
  await db.query('SELECT ios_delete_expense($1)',[id(30)]);
 });
 await asUser(null,async () => { await assert.rejects(add(id(31),id(10)),/permission denied/); });
 assert.equal(await balance(id(10)),1000);
});
test('invalid amount does not create an expense or alter money', async () => {
 await asUser(id(1),async () => {
  for(const amount of [-1,0,1.001,10000000000]) await assert.rejects(add(id(32),id(10),amount),/valid reason/);
  assert.equal(await balance(id(10)),1000);
 });
});
test('tab wrapper deduplicates, isolates receipts, and rolls back failed requests',async () => {
 const tabs=(request,profile,amount)=>db.query("SELECT ios_add_tabs($1,$2,'[]'::jsonb,$3)",[request,profile,amount]);
 await asUser(id(1),async () => {
  await tabs(id(40),id(10),10); await tabs(id(40),id(10),10);
  assert.equal(await balance(id(10)),990);
  await assert.rejects(tabs(id(40),id(10),11),/already used/);
  await assert.rejects(tabs(id(41),id(10),-1),/Invalid share/);
  assert.equal((await db.query('SELECT * FROM ios_tab_requests')).rows.length,1);
  assert.equal(await balance(id(10)),990);
 });
 await asUser(id(2),async () => {
  assert.equal((await db.query('SELECT * FROM ios_tab_requests')).rows.length,0);
  await tabs(id(40),id(12),20);
  assert.equal(await balance(id(12)),680);
 });
});
