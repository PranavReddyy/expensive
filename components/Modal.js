"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const editable = 'input:not([type="checkbox"]):not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)';
const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';

export default function Modal({ children, title, onClose, onSubmit, onError, busy, style, overlayStyle }) {
  const panel = useRef(null);
  const overlay = useRef(null);
  const submitting = useRef(false);
  const titleId = useId();

  function keepInputVisible() {
    const field = document.activeElement;
    const container = panel.current;
    if (!container?.contains(field)) return;
    const bounds = container.getBoundingClientRect();
    const input = field.getBoundingClientRect();
    if (input.bottom > bounds.bottom - 16) container.scrollTop += input.bottom - bounds.bottom + 16;
    else if (input.top < bounds.top + 16) container.scrollTop -= bounds.top + 16 - input.top;
  }

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const viewport = window.visualViewport;
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!overlay.current) return;
        overlay.current.style.height = `${viewport?.height || window.innerHeight}px`;
        overlay.current.style.top = `${viewport?.offsetTop || 0}px`;
        keepInputVisible();
      });
    };
    update();
    const fields = [...panel.current.querySelectorAll(editable)];
    fields.forEach((field, index) => {
      if (field.tagName === "INPUT") field.enterKeyHint = index < fields.length - 1 ? "next" : "done";
    });
    (panel.current?.querySelector(editable) || panel.current)?.focus({ preventScroll: true });
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy || submitting.current) return;
    submitting.current = true;
    try { await onSubmit?.(); }
    catch (error) { onError?.(error); }
    finally { submitting.current = false; }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy && !submitting.current) onClose();
    }
    if (event.key === "Tab") {
      const fields = [...panel.current.querySelectorAll(focusable)].filter((field) => field.getClientRects().length);
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
    if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target.type !== "checkbox" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const fields = [...panel.current.querySelectorAll(editable)];
      const next = fields[fields.indexOf(event.target) + 1];
      if (next) next.focus({ preventScroll: true });
      else panel.current.requestSubmit();
      keepInputVisible();
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={overlay} className="popup-overlay" style={{ ...overlayStyle, bottom: "auto", height: "100dvh" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy && !submitting.current) onClose();
      }}>
      <form ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="popup-panel" style={style} onSubmit={submit} onKeyDown={handleKeyDown}
        onFocusCapture={keepInputVisible}>
        <span id={titleId} className="sr-only">{title}</span>
        {children}
      </form>
    </div>, document.body,
  );
}
