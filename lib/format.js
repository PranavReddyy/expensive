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

export const fmt = (value) => "₹" + currency.format(Number(value || 0));
export const fmtExpenseDate = (value) => expenseDate.format(new Date(value));
export const fmtWeekday = (value) => weekday.format(new Date(value));

export const fmtFullExpenseDate = (value) => fullExpenseDate.format(new Date(value));
