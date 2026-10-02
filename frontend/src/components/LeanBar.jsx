import { usd } from "../lib/format.js";

/** Net delta as a share of gross, -1 (all short delta) to +1 (all long delta), centred bar. */
export default function LeanBar({ lean, width = 70 }) {
  const s = lean?.score;
  if (s == null) return <span className="faint">-</span>;
  const color = s >= 0.25 ? "var(--up)" : s <= -0.25 ? "var(--down)" : "var(--muted)";
  return (
    <span className="lean-bar" title={`Net delta ${usd(lean.net_delta_usd)} of ${usd(lean.gross_delta_usd)} gross`}>
      <i style={{ width }}><b style={{ left: `${50 + Math.min(0, s) * 50}%`, width: `${Math.abs(s) * 50}%`, background: color }} /></i>
      <span className="mono" style={{ fontSize: 12, color }}>{usd(lean.net_delta_usd)}</span>
    </span>
  );
}
