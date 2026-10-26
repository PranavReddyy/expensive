import { amountValue, validAmount } from './amount.mjs';
export function equalTripShares(amount, shares) {
 const values=Object.values(shares).map(v=>Math.round(Number(v)*100));
 return values.length>0 && values.reduce((a,b)=>a+b,0)===Math.round(Number(amount)*100) && Math.max(...values)-Math.min(...values)<=1;
}
export function tripStatistics(entries,start,end) {
 const days=Math.max(1,Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1)||1;
 const cents=entries.map(e=>Math.round(Number(e.amount)*100));
 return {count:entries.length,days,daily:cents.reduce((a,b)=>a+b,0)/100/days,largest:Math.max(0,...cents)/100};
}
export function splitTripAmount(amount, ids, custom = null) {
 const cents = Math.round(amountValue(amount)*100);
 if(!validAmount(amount)||!Number.isSafeInteger(cents)||cents<=0||!ids.length)throw new Error('Enter an amount and choose participants.');
 if(!custom){const base=Math.floor(cents/ids.length);return Object.fromEntries(ids.map((id,i)=>[id,(base+(i<cents%ids.length?1:0))/100]));}
 const blank=ids.filter(id=>custom[id]===''||custom[id]==null);
 if(blank.length>1)throw new Error('Fill all but one share; the last is calculated automatically.');
 let used=0;const result={};
 for(const id of ids){if(blank.includes(id))continue;const value=custom[id];if(!validAmount(value))throw new Error('Enter valid shares.');result[id]=Math.round(amountValue(value)*100);used+=result[id];}
 if(blank.length)result[blank[0]]=cents-used;
 if(Object.values(result).some(n=>n<0)||Object.values(result).reduce((a,b)=>a+b,0)!==cents)throw new Error('Shares must add up to the total.');
 return Object.fromEntries(Object.entries(result).map(([id,n])=>[id,n/100]));
}
