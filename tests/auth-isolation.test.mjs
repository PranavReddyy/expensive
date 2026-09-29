import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner = id(1), other = id(2), legacyProfile = id(10), legacyCategory = id(20), legacyPerson = id(30);
const migration = await readFile(new URL('../supabase-auth-migration.sql', import.meta.url), 'utf8');
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text UNIQUE, email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  CREATE PUBLICATION supabase_realtime;
`);
await db.exec(await readFile(new URL('../supabase-schema.sql', import.meta.url), 'utf8'));
await db.query('INSERT INTO profiles(id,name,balance) VALUES ($1,$2,1000)', [legacyProfile, 'Existing account']);
await db.query('INSERT INTO categories(id,name) VALUES ($1,$2)', [legacyCategory, 'Private category']);
await db.query('INSERT INTO expenses(id,profile_id,reason,amount,category_id) VALUES ($1,$2,$3,50,$4)', [id(40), legacyProfile, 'Existing expense', legacyCategory]);
await db.query('INSERT INTO people(id,profile_id,name) VALUES ($1,$2,$3)', [legacyPerson, legacyProfile, 'Existing person']);
await db.query("INSERT INTO debts(id,profile_id,person_id,direction,amount,remaining_amount,description) VALUES ($1,$2,$3,'they_owe_me',100,100,'Existing tab')", [id(50), legacyProfile, legacyPerson]);
await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)', [owner, 'pranavreddymitta@gmail.com']);
// Model the earlier permissive installation to ensure migration removes its access.
await db.exec('CREATE POLICY old_open_policy ON profiles FOR ALL USING(true) WITH CHECK(true); GRANT ALL ON profiles TO anon;');
await db.exec(migration);
after(() => db.close());

async function asUser(userId, run) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || '']);
  await db.exec(`SET ROLE ${userId ? 'authenticated' : 'anon'}`);
  try { return await run(); }
  finally { await db.exec('RESET ROLE'); }
}

test('migration preserves existing money and reserves records until the owner verifies email', async () => {
  const row = (await db.query('SELECT user_id,balance FROM profiles WHERE id=$1', [legacyProfile])).rows[0];
  assert.equal(row.user_id, null);
  assert.equal(Number(row.balance), 1000);
  await asUser(owner, async () => assert.equal((await db.query('SELECT * FROM profiles')).rows.length, 0));
  assert.equal((await db.query("SELECT * FROM pg_policies WHERE policyname='old_open_policy'")).rows.length, 0);
});

test('another verified email cannot claim the existing records or call the private claim function', async () => {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [other, 'another@example.com']);
  await asUser(other, async () => {
    assert.equal((await db.query('SELECT * FROM profiles')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM expenses')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM categories')).rows.length, 5);
    await assert.rejects(db.query('SELECT app_private.initialize_user($1)', [other]), /permission denied/);
    await assert.rejects(db.query('INSERT INTO profiles(name,user_id) VALUES ($1,$2)', ['Stolen', owner]), /row-level security/);
    await assert.rejects(db.query('INSERT INTO profiles(name,user_id) VALUES ($1,NULL)', ['Unowned']), /row-level security/);
  });
});

test('only the verified original email receives all its existing data without changing balances', async () => {
  await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [owner]);
  await asUser(owner, async () => {
    const profiles = (await db.query('SELECT * FROM profiles')).rows;
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].user_id, owner);
    assert.equal(Number(profiles[0].balance), 1000);
    for (const table of ['categories', 'expenses', 'people', 'debts'])
      assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 1);
  });
});

test('anonymous clients cannot read or write any app table or execute money functions', async () => {
  await asUser(null, async () => {
    for (const table of ['profiles', 'categories', 'expenses', 'people', 'debts', 'profile_transfers']) {
      await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
      await assert.rejects(db.query(`DELETE FROM ${table}`), /permission denied/);
    }
    await assert.rejects(db.query('SELECT add_tab($1,$2::jsonb,0)', [legacyProfile, '[]']), /permission denied/);
    await assert.rejects(db.query('SELECT settle_tab($1,$2,1,100,0)', [legacyProfile, legacyPerson]), /permission denied/);
    await assert.rejects(db.query('SELECT transfer_money($1,$2,$3,1)', [id(80), legacyProfile, id(11)]), /permission denied/);
  });
});

test('user-scoped CRUD works while guessed foreign IDs and ownership changes are denied', async () => {
  await asUser(other, async () => {
    await db.query('INSERT INTO profiles(id,name,balance) VALUES ($1,$2,500),($3,$4,0)', [id(11), 'My cash', id(12), 'My bank']);
    assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1', [id(11)])).rows[0].user_id, other);
    await db.query('INSERT INTO categories(id,name) VALUES ($1,$2)', [id(21), 'Private category']);
    await db.query('INSERT INTO people(id,profile_id,name) VALUES ($1,$2,$3)', [id(31), id(11), 'My person']);
    assert.equal((await db.query('UPDATE profiles SET balance=0 WHERE id=$1 RETURNING id', [legacyProfile])).rows.length, 0);
    assert.equal((await db.query('DELETE FROM expenses WHERE profile_id=$1 RETURNING id', [legacyProfile])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM people WHERE id=$1', [legacyPerson])).rows.length, 0);
    await assert.rejects(db.query('UPDATE profiles SET user_id=$1 WHERE id=$2', [owner, id(11)]), /row-level security/);
    await assert.rejects(db.query('UPDATE categories SET user_id=$1 WHERE id=$2', [owner, id(21)]), /row-level security/);
    await assert.rejects(db.query('INSERT INTO expenses(profile_id,reason,amount) VALUES ($1,$2,1)', [legacyProfile, 'Cross user']), /row-level security/);
    await assert.rejects(db.query('INSERT INTO expenses(profile_id,reason,amount,category_id) VALUES ($1,$2,1,$3)', [id(11), 'Foreign category', legacyCategory]), /row-level security/);
    await assert.rejects(db.query("INSERT INTO debts(profile_id,person_id,direction,amount,remaining_amount,description) VALUES ($1,$2,'they_owe_me',1,1,'Foreign person')", [id(11), legacyPerson]), /row-level security/);
    await db.query('INSERT INTO expenses(profile_id,reason,amount,category_id) VALUES ($1,$2,1,$3)', [id(11), 'Own expense', id(21)]);
    assert.equal((await db.query('SELECT * FROM expenses')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM profiles')).rows.length, 2);
    assert.equal((await db.query('SELECT * FROM people')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM debts')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM profile_transfers')).rows.length, 0);
  });
});

test('money RPCs reject cross-user accounts and preserve valid transfers and settlements', async () => {
  await asUser(other, async () => {
    await assert.rejects(db.query('SELECT transfer_money($1,$2,$3,10)', [id(81), id(11), legacyProfile]), /Account not found/);
    await assert.rejects(db.query('SELECT transfer_money($1,$2,$3,10)', [id(82), legacyProfile, id(11)]), /Account not found/);
    await assert.rejects(db.query('SELECT add_tab($1,$2::jsonb,0)', [legacyProfile, JSON.stringify([{person_id: legacyPerson, amount: 5, direction: 'they_owe_me', description: 'Attempt'}])]), /Account not found/);
    await assert.rejects(db.query('SELECT settle_tab($1,$2,100,100,0)', [legacyProfile, legacyPerson]), /Account not found/);
    await assert.rejects(db.query('INSERT INTO profile_transfers(id,from_profile,to_profile,amount) VALUES ($1,$2,$3,1)', [id(83), id(11), legacyProfile]), /row-level security/);
    await db.query('SELECT transfer_money($1,$2,$3,20)', [id(84), id(11), id(12)]);
    await db.query('SELECT transfer_money($1,$2,$3,20)', [id(84), id(11), id(12)]);
    assert.deepEqual((await db.query('SELECT balance FROM profiles ORDER BY id')).rows.map(row => Number(row.balance)), [480,20]);
    await db.query('SELECT add_tab($1,$2::jsonb,0)', [id(11), JSON.stringify([{person_id: id(31), amount: 10, direction: 'i_owe_them', description: 'Lunch'}])]);
    await db.query('SELECT settle_tab($1,$2,10,0,10)', [id(11), id(31)]);
    assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1', [id(11)])).rows[0].balance),470);
    assert.equal((await db.query('SELECT * FROM expenses')).rows.length, 2);
  });
  assert.equal(Number((await db.query('SELECT balance FROM profiles WHERE id=$1', [legacyProfile])).rows[0].balance),1000);
  await asUser(owner, async () => assert.equal((await db.query('SELECT * FROM profile_transfers')).rows.length,0));
});

test('rerunning the migration keeps assigned ownership and categories intact', async () => {
  await db.exec(migration);
  assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1', [legacyProfile])).rows[0].user_id,owner);
  await asUser(other, async () => assert.equal((await db.query('SELECT * FROM categories')).rows.length,6));
});

test('an owner verified before migration receives the legacy rows immediately', async () => {
  // Recreate only the pre-migration ownership state, preserving the verified account.
  await db.exec('DROP TRIGGER expensive_user_verified ON auth.users;');
  await db.query('UPDATE profiles SET user_id=NULL WHERE id=$1', [legacyProfile]);
  await db.query('UPDATE categories SET user_id=NULL WHERE id=$1', [legacyCategory]);
  await db.exec('UPDATE app_private.legacy_owner SET claimed_by=NULL;');
  await db.exec(migration);
  assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1', [legacyProfile])).rows[0].user_id,owner);
  assert.equal((await db.query('SELECT user_id FROM categories WHERE id=$1', [legacyCategory])).rows[0].user_id,owner);
});
