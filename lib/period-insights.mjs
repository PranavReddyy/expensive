export function periodInsights(expenses, start, end, now = new Date()) {
  const rows = expenses.filter(row => {
    const date = new Date(row.created_at);
    return date >= start && date < end && date <= now;
  });
  const total = rows.reduce((sum,row) => sum + Math.round(Number(row.amount)*100),0)/100;
  const today = new Date(now); today.setHours(0,0,0,0);
  const completedEnd = new Date(Math.min(end.getTime(),today.getTime()));
  const spentDays = new Set(rows.filter(row => new Date(row.created_at) < completedEnd).map(row => new Date(row.created_at).toDateString()));
  let completedDays = 0, elapsedDays = 0, totalDays = 0;
  for (const day = new Date(start); day < end; day.setDate(day.getDate()+1)) {
    totalDays++;
    if (day < completedEnd) completedDays++;
    if (day <= now) elapsedDays++;
  }
  const dailyAverage = elapsedDays ? total/elapsedDays : 0;
  const projected = now >= start && now < end ? dailyAverage*totalDays : null;
  return { rows,total,dailyAverage,projected,noSpendDays:Math.max(0,completedDays-spentDays.size),largest:[...rows].sort((a,b) => Number(b.amount)-Number(a.amount)).slice(0,3) };
}

export function projectedBalance(balance, total, projected) {
  return Number(balance) - Math.max(0,(projected ?? total)-total);
}
