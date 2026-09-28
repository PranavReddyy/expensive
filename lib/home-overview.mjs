export function homeOverview(expenses, now = new Date()) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i);
    return { key: date.toDateString(), label: date.toLocaleDateString('en-IN', { weekday: 'short' }), amount: 0 };
  });
  let month = 0, count = 0;
  const categories = new Map();
  for (const expense of expenses) {
    const date = new Date(expense.created_at), value = Number(expense.amount);
    if (!Number.isFinite(value) || date > now) continue;
    const day = days.find(day => day.key === date.toDateString());
    if (day) day.amount += value;
    if (date.getFullYear() !== now.getFullYear() || date.getMonth() !== now.getMonth()) continue;
    month += value; count++;
    const name = expense.categories?.name || 'uncategorized';
    categories.set(name, (categories.get(name) || 0) + value);
  }
  return { days, month, count, today: days[6].amount, top: [...categories].sort((a,b) => b[1]-a[1]).slice(0,3) };
}
