import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();after(()=>db.close());
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE PUBLICATION supabase_realtime;`);
await db.exec(await read('tests/fixtures/legacy-schema.sql'));
await db.exec(`INSERT INTO auth.users VALUES('${id(1)}','one@example.invalid',now(),'{}'),('${id(2)}','two@example.invalid',now(),'{}');
ALTER TABLE profiles ADD user_id uuid REFERENCES auth.users DEFAULT auth.uid();
ALTER TABLE categories DROP CONSTRAINT categories_name_key;ALTER TABLE categories ADD user_id uuid REFERENCES auth.users DEFAULT auth.uid();
ALTER TABLE categories ADD UNIQUE(user_id,name);
INSERT INTO profiles(id,user_id,name,balance) VALUES('${id(10)}','${id(1)}','Bank',1000),('${id(11)}','${id(2)}','Other',500);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
await db.exec(await read('ios/Database/native-operations.sql'));
await db.exec((await read('supabase-firebase-migration.sql')).replaceAll('YOUR_FIREBASE_PROJECT_ID','test-identity'));
await db.exec(`SELECT enroll_firebase_user('old-one','one@example.invalid','test-identity');SELECT enroll_firebase_user('old-two','two@example.invalid','test-identity');`);
await db.exec(await read('supabase-auth-prepare.sql'));
await db.exec(`SELECT auth_migration_username('${id(1)}','firstuser');SELECT auth_migration_username('${id(2)}','seconduser');`);
const cutover=(await read('supabase-auth-cutover.sql')).replaceAll('YOUR_SUPABASE_URL','https://test.supabase.co');
await db.exec(cutover);await db.exec(cutover);
async function role(name,fn){await db.exec('SET ROLE '+name);try{return await fn();}finally{await db.exec('RESET ROLE');}}
async function asUser(owner,fn,extra={}){
await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,iss:'https://test.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',...extra})]);
return role('authenticated',fn);
}
test('Supabase cutover preserves owner IDs and balances with RLS isolation',async()=>{
 await asUser(id(1),async()=>{
  assert.equal((await db.query('SELECT current_app_user_id() id')).rows[0].id,id(1));
  const rows=(await db.query('SELECT * FROM profiles')).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].balance),1000);
  await assert.rejects(db.query(`INSERT INTO profiles(user_id,name) VALUES('${id(2)}','steal')`),/row-level security/);
 });
});
test('profile deletion is owner scoped and requires exact confirmation',async()=>{
 await db.exec(await read('ios/Database/activity-history.sql'));
 await db.exec(await read('supabase-expense-upgrades.sql'));
 await db.exec(await read('supabase-profile-deletion.sql'));
 await asUser(id(2),async()=>{
  await assert.rejects(db.query('SELECT delete_profile($1,$2)',[id(10),'Bank']),/not found/);
  await assert.rejects(db.query('SELECT delete_profile($1,$2)',[id(11),'wrong']),/exact profile name/);
  assert.equal(Number((await db.query('SELECT balance FROM profiles')).rows[0].balance),500);
 });
 await db.exec(`INSERT INTO profiles(id,user_id,name,balance) VALUES('${id(12)}','${id(2)}','Disposable',25);
 INSERT INTO people(id,profile_id,name) VALUES('${id(13)}','${id(12)}','Friend');
 INSERT INTO debts(id,profile_id,person_id,direction,amount,remaining_amount,description) VALUES('${id(14)}','${id(12)}','${id(13)}','they_owe_me',10,10,'Open');`);
 await asUser(id(2),()=>assert.rejects(db.query('SELECT delete_profile($1,$2)',[id(12),'Disposable']),/open Tabs/));
 await db.exec(`UPDATE debts SET remaining_amount=0 WHERE id='${id(14)}'`);
 await asUser(id(2),async()=>{
  await db.query('SELECT delete_profile($1,$2)',[id(12),'Disposable']);
  const rows=(await db.query('SELECT * FROM profiles')).rows;
  assert.equal(rows.length,1);assert.equal(Number(rows[0].balance),500);
 });
});
test('old Firebase and forged issuer/audience tokens cannot read balances',async()=>{
 for(const [sub,extra] of [['old-one',{iss:'https://securetoken.google.com/test-identity',aud:'test-identity'}],[id(1),{iss:'https://other.supabase.co/auth/v1'}],[id(1),{aud:'wrong'}]]){
  await asUser(sub,async()=>assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0),extra);
 }
});
test('username reservation is owner bound, immutable and private',async()=>{
 await db.exec(`INSERT INTO auth.users VALUES('${id(3)}','new@example.invalid',now(),'{}');`);
 await asUser(id(3),async()=>{
  await assert.rejects(db.query("SELECT claim_username('firstuser')"),/unavailable/);
  await db.query("SELECT claim_username('thirduser')");await db.query("SELECT claim_username('thirduser')");
  await assert.rejects(db.query("SELECT claim_username('anothername')"),/already set/);
  assert.equal((await db.query('SELECT * FROM categories')).rows.length,5);
  await assert.rejects(db.query("SELECT login_email('firstuser')"),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM app_private.supabase_usernames'),/permission denied/);
 });
 assert.equal((await db.query(`SELECT raw_app_meta_data->>'username' name FROM auth.users WHERE id='${id(3)}'`)).rows[0].name,'thirduser');
});
test('anonymous users cannot reserve names or enroll; server username login is rate limited',async()=>{
 await role('anon',async()=>{
  assert.equal((await db.query("SELECT username_available('firstuser') ok")).rows[0].ok,false);
  await assert.rejects(db.query("SELECT claim_username('stolen')"),/permission denied/);
 });
 await role('service_role',async()=>{
  await assert.rejects(db.query("SELECT enroll_firebase_user('new','new@example.invalid','test-identity')"),/permission denied/);
  for(let n=0;n<15;n++)assert.equal((await db.query("SELECT limit_password_login('test-key') ok")).rows[0].ok,true);
  assert.equal((await db.query("SELECT limit_password_login('test-key') ok")).rows[0].ok,false);
 });
});
test('unverified Supabase users cannot access money or reserve names',async()=>{
 await db.exec(`INSERT INTO auth.users VALUES('${id(4)}','unverified@example.invalid',NULL,'{}');`);
 await asUser(id(4),async()=>{
  assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0);
  await assert.rejects(db.query("SELECT claim_username('unverified')"),/Verify/);
 });
});
test('new auth runtime has no Firebase SDK or bootstrap dependency',async()=>{
 for(const file of ['components/AuthProvider.js','lib/supabase.js','ios/Expensive/API.swift']){
  assert.doesNotMatch(await read(file),/firebase|api\/auth\/bootstrap|securetoken\.google/i);
 }
});
test('Supabase expense retries deduct once, and data deletion stays server-only and isolated',async()=>{
 await db.exec(await read('ios/Database/activity-history.sql'));
 await db.exec(await read('supabase-expense-upgrades.sql'));
 await db.exec(await read('supabase-data-deletion.sql'));
 await db.exec(await read('supabase-auth-data-deletion.sql'));
 await asUser(id(1),async()=>{
  const record=()=>db.query('SELECT ios_add_expense($1,$2,$3,$4,$5,$6,$7)',[id(90),id(10),'Offline lunch',25,'','2026-10-14T10:00:00Z',null]);
  await record();await record();
  assert.equal(Number((await db.query('SELECT balance FROM profiles')).rows[0].balance),975);
  assert.equal((await db.query('SELECT * FROM expenses')).rows.length,1);
  await assert.rejects(db.query('SELECT delete_expensive_data($1::uuid)',[id(1)]),/permission denied/);
 });
 await role('service_role',()=>db.query('SELECT delete_expensive_data($1::uuid)',[id(1)]));
 await asUser(id(2),async()=>assert.equal(Number((await db.query('SELECT balance FROM profiles')).rows[0].balance),500));
 await asUser(id(1),async()=>{
  assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM expenses')).rows.length,0);
 });
});
