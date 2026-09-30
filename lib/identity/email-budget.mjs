import { createHash, randomUUID } from 'node:crypto';

export async function reserveEmailBudget(db, kind, email, dailyLimit, now = Date.now()) {
  const ref = db.collection('emailLimits').doc(createHash('sha256').update(kind + ':' + email).digest('hex'));
  const budget = db.collection('emailLimits').doc('daily-' + new Date(now).toISOString().slice(0, 10));
  const reservation = randomUUID();
  const permitted = await db.runTransaction(async tx => {
    const [address, daily] = await Promise.all([tx.get(ref), tx.get(budget)]);
    const old = address.data();
    const start = old?.start > now - 3600000 ? old.start : now;
    const count = start === old?.start ? old.count : 0;
    if (old?.last > now - 60000 || count >= 5 || (daily.data()?.count || 0) >= dailyLimit) return false;
    tx.set(ref, { start, count: count + 1, last: now, reservation, expiresAt: new Date(now + 86400000) });
    tx.set(budget, { count: (daily.data()?.count || 0) + 1, expiresAt: new Date(now + 172800000) });
    return true;
  });
  if (!permitted) return null;
  return async () => db.runTransaction(async tx => {
    const [address, daily] = await Promise.all([tx.get(ref), tx.get(budget)]);
    const old = address.data();
    // Only refund our own rejected attempt; never overwrite a later request.
    if (old?.reservation !== reservation) return;
    tx.set(ref, { ...old, count: Math.max(0, old.count - 1), last: 0, reservation: null });
    tx.set(budget, { ...daily.data(), count: Math.max(0, (daily.data()?.count || 0) - 1) });
  });
}
