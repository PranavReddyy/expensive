// Quote every field and neutralize spreadsheet formulas in user-entered text.
export function csvValue(value) {
  const text=value == null ? '' : typeof value==='object' ? JSON.stringify(value) : String(value);
  const safe=typeof value!=='number' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'"+text : text;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function toCSV(rows,columns) {
  return '\uFEFF'+[columns.map(csvValue).join(','),...rows.map(row=>columns.map(key=>csvValue(row[key])).join(','))].join('\r\n');
}
