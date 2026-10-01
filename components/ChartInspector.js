"use client";
import { useState } from 'react';
import { fmt } from '../lib/format';
export default function ChartInspector({ data, children }) {
  const [selected, setSelected] = useState(null);
  const point = selected === null ? null : data[Math.min(selected,data.length-1)];
  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setSelected(Math.max(0,Math.min(data.length-1,Math.floor((event.clientX-bounds.left)/bounds.width*data.length))));
  }
  return <div>
    <div onPointerDown={inspect} onPointerMove={event => { if (event.buttons || event.pointerType === 'mouse') inspect(event); }}>{children}</div>
    <p aria-live="polite" className="history-note" style={{minHeight:18}}>{point ? `${point.detail || point.label} · ${fmt(point.value)}` : 'Touch the chart to inspect spending.'}</p>
    <input type="range" aria-label="Inspect chart point" aria-valuetext={point ? `${point.detail || point.label}: ${fmt(point.value)}` : 'Select a point'} min="0" max={Math.max(0,data.length-1)} value={selected ?? 0} onChange={event => setSelected(Number(event.target.value))} style={{width:'100%',appearance:'auto',accentColor:'var(--text)'}} />
  </div>;
}
