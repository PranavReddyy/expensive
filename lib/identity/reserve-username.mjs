import { normalizeUsername } from './username.mjs';

export async function reserveUsername(db, uid, value) {
  let username;
  try { username = normalizeUsername(value); }
  catch (error) { throw Object.assign(error, { status: 400 }); }
  const account = db.collection('identities').doc(uid);
  const reservation = db.collection('usernames').doc(username);
  await db.runTransaction(async transaction => {
    const [current, taken] = await Promise.all([transaction.get(account), transaction.get(reservation)]);
    if (current.exists && current.data().username !== username) throw Object.assign(new Error('Your account already has a username.'), { status: 409 });
    if (taken.exists && taken.data().uid !== uid) throw Object.assign(new Error('That username is already taken.'), { status: 409 });
    if (!current.exists) transaction.create(account, { username, createdAt: new Date() });
    if (!taken.exists) transaction.create(reservation, { uid });
  });
  return username;
}
