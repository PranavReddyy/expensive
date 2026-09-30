const reserved = new Set(['admin', 'administrator', 'support', 'system', 'firebase', 'expensive', 'root', 'null', 'undefined']);
export function normalizeUsername(value) {
  if (typeof value !== 'string') throw new Error('Enter a username.');
  const username = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) throw new Error('Use 3–24 letters, numbers, or underscores, starting with a letter.');
  if (reserved.has(username)) throw new Error('That username is reserved.');
  return username;
}
