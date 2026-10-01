const currency = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const expenseDate = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const fullExpenseDate = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export const currencySymbols = { INR:'₹', USD:'$', EUR:'€', GBP:'£', AED:'AED ', JPY:'¥', CAD:'CA$', AUD:'A$' };
let selectedCurrency = 'INR';
export const setCurrency = code => { selectedCurrency = currencySymbols[code] ? code : 'INR'; };
export const currencySymbol = () => currencySymbols[selectedCurrency];
export const fmt = (value) => currencySymbol() + currency.format(Number(value || 0));
export const fmtExpenseDate = (value) => expenseDate.format(new Date(value));
export const fmtWeekday = (value) => weekday.format(new Date(value));

export const fmtFullExpenseDate = (value) => fullExpenseDate.format(new Date(value));
