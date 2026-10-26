// Deliberately not JavaScript evaluation: only decimal arithmetic is accepted.
export function amountValue(input) {
  const text = String(input).trim();
  try {
    if (!text.startsWith('=')) {
      if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return NaN;
      const value = Number(text);
      return Math.abs(value) < 1e10 ? value : NaN;
    }
    if (text.length > 256) return NaN;
    const source = text.slice(1); let index = 0;
    const skip = () => { while (/\s/.test(source[index] || '') && index < source.length) index++; };
    const take = token => { skip(); if (source[index] === token) { index++; return true; } return false; };
    const factor = () => {
      if (take('+')) return factor();
      if (take('-') || take('−')) { const [n,d] = factor(); return [-n,d]; }
      if (take('(')) { const value = sum(); if (!take(')')) throw Error(); return value; }
      skip(); const token = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
      if (!token || token.length > 24) throw Error(); index += token.length;
      const [whole, fraction=''] = token.split('.');
      return [BigInt((whole || '0') + fraction), 10n ** BigInt(fraction.length)];
    };
    const product = () => {
      let [n,d] = factor();
      for (;;) {
        if (take('*') || take('×')) { const [a,b] = factor(); n *= a; d *= b; }
        else if (take('/') || take('÷')) { const [a,b] = factor(); if (a === 0n) throw Error(); n *= b; d *= a; }
        else return [n,d];
      }
    };
    const sum = () => {
      let [n,d] = product();
      for (;;) {
        let sign; if (take('+')) sign=1n; else if (take('-') || take('−')) sign=-1n; else return [n,d];
        const [a,b] = product(); n = n*b + sign*a*d; d *= b;
      }
    };
    let [n,d] = sum(); skip(); if (index !== source.length) return NaN;
    const negative = (n < 0n) !== (d < 0n); n = n < 0n ? -n : n; d = d < 0n ? -d : d;
    const pennies = (n*100n*2n+d)/(2n*d); // round halves away from zero, once
    if (pennies >= 1000000000000n) return NaN;
    return Number(pennies) / 100 * (negative ? -1 : 1);
  } catch { return NaN; }
}
export const validAmount = (input, negative=false) => Number.isFinite(amountValue(input)) && (negative || amountValue(input)>=0);
