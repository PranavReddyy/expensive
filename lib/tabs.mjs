import { amountValue, validAmount } from './amount.mjs';
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
  const total = Math.round(amountValue(value) * 100), shares = count + Number(includesYou);
  if (!Number.isSafeInteger(total) || total <= 0 || count < 1 || total < shares) throw new Error('Enter enough for at least 0.01 per person.');
  const base = Math.floor(total / shares), remainder = total % shares;
  const amounts = Array.from({ length: shares }, (_, i) => (base + Number(i < remainder)) / 100);
  return { amounts: amounts.slice(0, count), ownShare: includesYou ? amounts[count] : 0 };
}

export function customSplit(value, fields, includesYou) {
  const cents = text => {
    if (!validAmount(text)) throw new Error('Enter a valid amount or calculation starting with =.');
    const number = Math.round(amountValue(text)*100);
    if (!Number.isSafeInteger(number) || number<0 || number>=1e12) throw new Error('Enter a valid amount.');
    return number;
  };
  const total=cents(value),blank=fields.map((v,i)=>String(v).trim()===''?i:-1).filter(i=>i>=0);
  if(blank.length>1) throw new Error('Fill all but one share to calculate the remainder.');
  const amounts=fields.map(v=>String(v).trim()===''?0:cents(v));
  const sum=amounts.reduce((a,b)=>a+b,0);
  if(blank.length===1) amounts[blank[0]]=total-sum;
  if(total<=0 || amounts.some(n=>n<0) || amounts.reduce((a,b)=>a+b,0)!==total) throw new Error('Shares must add up to the full payment.');
  const count=fields.length-Number(includesYou);
  if(count<1 || amounts.slice(0,count).some(n=>n<=0)) throw new Error('Each person’s share must be greater than zero.');
  return {amounts:amounts.slice(0,count).map(n=>n/100),ownShare:includesYou?amounts[count]/100:0};
}
