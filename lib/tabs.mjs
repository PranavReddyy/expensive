export function summarizeTabs(debts) {
  const people = new Map();
  let collect = 0, pay = 0;
  for (const debt of debts) {
    const amount = Math.round(Number(debt.remaining_amount) * 100);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const row = people.get(debt.person_id) || { collect: 0, pay: 0, entries: [] };
    if (debt.direction === 'they_owe_me') { row.collect += amount; collect += amount; }
    else { row.pay += amount; pay += amount; }
    row.entries.push(debt); people.set(debt.person_id, row);
  }
  return { people, collect: collect / 100, pay: pay / 100 };
}
export function splitAmount(value, count, includesYou) {
  const total = Math.round(Number(value) * 100), shares = count + Number(includesYou);
  if (!Number.isSafeInteger(total) || total <= 0 || count < 1 || total < shares) throw new Error('Enter enough for at least 0.01 per person.');
  const base = Math.floor(total / shares), remainder = total % shares;
  const amounts = Array.from({ length: shares }, (_, i) => (base + Number(i < remainder)) / 100);
  return { amounts: amounts.slice(0, count), ownShare: includesYou ? amounts[count] : 0 };
}
