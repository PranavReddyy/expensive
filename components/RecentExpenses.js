"use client";
import { useLayoutEffect, useRef } from "react";

// Home is a fixed-height summary. Show only complete rows that fit; the full
// history remains one tap away on Expenses.
export default function RecentExpenses({ children, style }) {
  const list = useRef(null);
  useLayoutEffect(() => {
    const container = list.current;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = container.getBoundingClientRect().bottom;
        const rows = [...container.children];
        const visible = rows.map((row) => row.getBoundingClientRect().bottom <= bottom);
        rows.forEach((row, index) => {
          row.style.visibility = visible[index] ? "visible" : "hidden";
          row.setAttribute("aria-hidden", String(!visible[index]));
        });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const row of container.children) observer.observe(row);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [children]);
  return <div ref={list} className="home-recent-list" style={style}>{children}</div>;
}
