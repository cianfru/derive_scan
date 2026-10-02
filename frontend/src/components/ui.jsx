import { useEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { SIGNAL_LABEL, signalTone } from "../lib/format.js";

export function Signal({ s }) {
  return <span className={`sig ${signalTone(s)}`}>{s ? SIGNAL_LABEL[s] || s : "-"}</span>;
}

export function Tabs({ items, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

// (i) popover: explanations live behind it, keeping visible text minimal.
export function Info({ children, label = "More information" }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const reposition = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(300, innerWidth * 0.82);
    const height = pop.current?.getBoundingClientRect().height || 0;
    setPos({ left: Math.max(12, Math.min(innerWidth - w - 12, r.left - w / 2 + 8)),
      top: Math.max(12, Math.min(r.bottom + 8, innerHeight - height - 12)) });
  }, [open]);
  return (
    <>
      <button ref={btn} className="info" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>i</button>
      {open && createPortal(<div id={id} ref={pop} className="pop" role="dialog" aria-label={label} style={pos}
        onClick={(e) => e.stopPropagation()}>{children}</div>, document.body)}
    </>
  );
}

export function Plate({ title, info, right, children, className = "", bodyClass = "" }) {
  return (
    <section className={`plate ${className}`}>
      {(title || right) && (
        <div className="plate-h">
          {title && <span className="label"><i className="tick" />{title}{info && <Info>{info}</Info>}</span>}
          {right}
        </div>
      )}
      <div className={`plate-b ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Spark({ values, w = 96, h = 26 }) {
  if (!values || values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), r = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / r) * (h - 4)).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" />
    </svg>
  );
}

export function Loading() { return <div className="loading"><div className="spin" aria-label="Loading" /></div>; }
export function Failed({ error }) { return <div className="error">{String(error?.message || error)}</div>; }
