import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner=id(1), foreign=id(2), profile=id(10);
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
 $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE PUBLICATION supabase_realtime;
`);
await db.exec(await readFile(new URL('./fixtures/legacy-schema.sql',import.meta.url),'utf8'));
await db.exec(`
 INSERT INTO auth.users VALUES('${owner}','pranavreddymitta@gmail.com',now()),('${foreign}','other@example.com',now());
 ALTER TABLE profiles ADD COLUMN user_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
 ALTER TABLE categories DROP CONSTRAINT categories_name_key;
 ALTER TABLE categories ADD COLUMN user_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
 ALTER TABLE categories ADD UNIQUE(user_id,name);
 INSERT INTO profiles(id,user_id,name,balance) VALUES('${profile}','${owner}','Existing',1000),('${id(11)}','${foreign}','Other',500);
 INSERT INTO categories(id,user_id,name) VALUES('${id(20)}','${owner}','Private');
 INSERT INTO expenses(id,profile_id,reason,amount,category_id) VALUES('${id(30)}','${profile}','Old expense',25,'${id(20)}');
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
`);
await db.exec(await readFile(new URL('../ios/Database/native-operations.sql',import.meta.url),'utf8'));
const sql=(await readFile(new URL('../supabase-firebase-migration.sql',import.meta.url),'utf8')).replaceAll('YOUR_FIREBASE_PROJECT_ID','test-identity');
await db.exec(sql);
after(()=>db.close());
async function role(name, fn) {
 await db.exec('SET ROLE '+name); try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
async function asUser(uid,fn,extra={}) {
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({
   sub:uid,iss:'https://securetoken.google.com/test-identity',aud:'test-identity',email_verified:true,role:'authenticated',...extra
 })]);
 return role('authenticated',fn);
}
const enroll=(uid,email)=>role('service_role',()=>db.query("SELECT enroll_firebase_user($1,$2,'test-identity') AS id",[uid,email]));

test('verified server enrollment preserves UUID, balance, categories, and expense history',async()=>{
 const row=(await enroll('firebase-owner','pranavreddymitta@gmail.com')).rows[0];
 assert.equal(row.id,owner);
 await asUser('firebase-owner',async()=>{
  assert.equal((await db.query('SELECT current_app_user_id() AS id')).rows[0].id,owner);
  assert.equal(Number((await db.query('SELECT balance FROM profiles')).rows[0].balance),1000);
  assert.equal((await db.query('SELECT * FROM expenses')).rows.length,1);
  assert.equal((await db.query('SELECT * FROM categories')).rows.length,1);
 });
 assert.equal((await enroll('firebase-owner','changed@example.com')).rows[0].id,owner);
 await assert.rejects(enroll('impostor','pranavreddymitta@gmail.com'),/already linked/);
});
test('new identities receive private UUIDs and default categories; enrollment is idempotent',async()=>{
 const first=(await enroll('firebase-new','new@example.com')).rows[0].id;
 assert.notEqual(first,owner);
 assert.equal((await enroll('firebase-new','new@example.com')).rows[0].id,first);
 await asUser('firebase-new',async()=>{
  assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM categories')).rows.length,5);
  await db.query("INSERT INTO profiles(id,name,balance) VALUES($1,'Mine',250)",[id(12)]);
  assert.equal((await db.query('SELECT user_id FROM profiles')).rows[0].user_id,first);
  await assert.rejects(db.query("INSERT INTO profiles(name,user_id) VALUES('Steal',$1)",[owner]),/row-level security/);
  await assert.rejects(db.query("INSERT INTO expenses(profile_id,reason,amount,category_id) VALUES($1,'Foreign category',1,$2)",[id(12),id(20)]),/row-level security/);
 });
});
test('wrong issuer, wrong project, unverified, unregistered and legacy tokens have no financial access',async()=>{
 for(const extra of [{iss:'https://securetoken.google.com/evil'},{aud:'evil'},{email_verified:false},{role:'anon'},{iss:'https://old.supabase.co/auth/v1'}]){
  await asUser('firebase-owner',async()=>{
   assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0);
   await assert.rejects(db.query("INSERT INTO profiles(name) VALUES('No access')"),/row-level security/);
  },extra);
 }
 await asUser('missing',async()=>assert.equal((await db.query('SELECT * FROM expenses')).rows.length,0));
});
test('clients cannot enroll themselves or read the private mapping; anonymous access denied',async()=>{
 await asUser('firebase-owner',async()=>{
  await assert.rejects(db.query("SELECT enroll_firebase_user('steal','pranavreddymitta@gmail.com','test-identity')"),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM app_private.firebase_accounts'),/permission denied/);
 });
 await role('anon',async()=>{
  for(const table of ['profiles','categories','expenses','people','debts','profile_transfers','ios_tab_requests'])
   await assert.rejects(db.query('SELECT * FROM '+table),/permission denied/);
  await assert.rejects(db.query('SELECT ios_delete_expense($1)',[id(30)]),/permission denied/);
 });
});
test('money RPCs preserve ownership and retry behavior under Firebase tokens',async()=>{
 await asUser('firebase-owner',async()=>{
  await db.query("INSERT INTO profiles(id,name,balance) VALUES($1,'Bank',0)",[id(13)]);
  await db.query('SELECT transfer_money($1,$2,$3,100)',[id(40),profile,id(13)]);
  await db.query('SELECT transfer_money($1,$2,$3,100)',[id(40),profile,id(13)]);
  assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[profile])).rows[0].balance),900);
  await db.query("INSERT INTO people(id,profile_id,name) VALUES($1,$2,'Friend')",[id(50),profile]);
  const rows=JSON.stringify([{person_id:id(50),amount:10,direction:'they_owe_me',description:'Lunch'}]);
  await db.query('SELECT ios_add_tabs($1,$2,$3,0)',[id(60),profile,rows]);
  await db.query('SELECT ios_add_tabs($1,$2,$3,0)',[id(60),profile,rows]);
  await db.query('SELECT settle_tab($1,$2,10,10,0)',[profile,id(50)]);
  assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1',[profile])).rows[0].balance),900);
  await assert.rejects(db.query('SELECT transfer_money($1,$2,$3,1)',[id(41),profile,id(11)]),/Account not found/);
 });
 await asUser('firebase-new',async()=>{
  assert.equal((await db.query('UPDATE profiles SET balance=0 WHERE id=$1 RETURNING id',[profile])).rows.length,0);
  await assert.rejects(db.query('SELECT add_tab($1,$2,0)',[profile,'[]']),/Account not found/);
 });
});
test('migration rerun preserves enrollment and ownership',async()=>{
 await db.exec(sql);
 assert.equal((await enroll('firebase-owner','pranavreddymitta@gmail.com')).rows[0].id,owner);
 await asUser('firebase-new',async()=>assert.equal((await db.query('SELECT * FROM categories')).rows.length,5));
});
