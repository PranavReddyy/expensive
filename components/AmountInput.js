import { amountValue } from '../lib/amount.mjs';

export default function AmountInput({value, inputMode: _inputMode, ...props}) {
  const formula=String(value ?? '').trim().startsWith('=');
  const result=formula ? amountValue(value) : NaN;
  return <><input {...props} value={value} type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} title="Amount, or start with = to calculate (for example =120+80/2)"/>{formula && <small role="status" style={{display:'block',fontSize:11,color:'var(--muted)',marginTop:4}}>{Number.isFinite(result)?`= ${result.toFixed(2)}`:'Enter a calculation using + − × ÷'}</small>}</>;
}
