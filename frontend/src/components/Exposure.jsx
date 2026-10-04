import { Info } from "./ui.jsx";
import { useData } from "../lib/data.js";
import { dayLabel, money, signed } from "../lib/questions.js";
import { totalMostLose } from "../lib/exposure.js";

const usd = (v) => money(v, { cents: true });
const tone = (v) => (v > 0.004 ? "up" : v < -0.004 ? "down" : "");

/** "$12.40", or "No limit" for an unlimited amount. */
export const amount = (v) => (v === Infinity ? "No limit" : usd(v));

/**
 * The result at Derive's 08:00 UTC settlement over the settlement price, after everything paid: one
 * line per combined position (`curves`: [{ combo, label, kind }]), the zero line, and the price now
 * as the orange hairline. `kind` "with" is the proposed trade on top (solid) over what is held (dashed).
 */
export function ExposureChart({ curves, index = null, und }) {
  const W = 320, H = 132, pad = 14, top = 12, base = H - 26;
  const strikes = curves.flatMap((c) => c.combo.strikes);
  if (!strikes.length) return null;
  const lo = Math.min(...strikes), hi = Math.max(...strikes);
  const span = hi - lo || hi * 0.1 || 1;
  const x0 = Math.max(0, lo - span * 0.6), x1 = hi + span * 0.6;
  const xs = [...new Set([x0, ...strikes.filter((k) => k > x0 && k < x1), x1])].sort((a, b) => a - b);
  const lines = curves.map((c) => ({ ...c, pts: xs.map((s) => [s, c.combo.pl(s)]) }));
  const ys = lines.flatMap((l) => l.pts.map(([, v]) => v)).concat(0);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const x = (v) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad);
  const y = (v) => base - ((v - y0) / (y1 - y0)) * (base - top);
  const now = Number.isFinite(index) && index > x0 && index < x1 ? x(index) : null;
  const ticks = lo === hi ? [lo] : [lo, hi];
  const label = curves.map((c) => `${c.label}: at most ${amount(c.combo.mostLose)} lost, at most ${amount(c.combo.mostPays)} paid back`).join("; ");
  return (
    <svg className="payzone ex-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${und} result at settlement, after what was paid. ${label}`}>
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="pz-axis" />
      {lines.map((l) => (
        <path key={l.label} d={l.pts.map(([s, v], i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
          className={l.kind === "held" && curves.length > 1 ? "pz-line ex-held" : "pz-line"} />
      ))}
      {now != null && <line x1={now} x2={now} y1={top - 6} y2={base + 4} className="pz-now" />}
      <text x={pad} y={y(0) - 4} className="pz-t">$0</text>
      {y1 > 0.005 && <text x={W - pad} y={y(y1) + 10} className="pz-t" textAnchor="end">{signed(y1)}</text>}
      {y0 < -0.005 && <text x={W - pad} y={y(y0) - 3} className="pz-t" textAnchor="end">{signed(y0)}</text>}
      {ticks.map((v) => <text key={v} x={x(v)} y={H - 8} className="pz-t mono" textAnchor="middle">{money(v)}</text>)}
    </svg>
  );
}

/** Breakevens as text, or why there is none. */
export function breakevenText(c) {
  if (c.breakevens.length) return c.breakevens.map((b) => money(b)).join(" and ");
  return c.mostLose === 0 ? "None, it never ends below what you paid" : "None, it ends below what you paid at every price";
}

function Group({ g }) {
  const { data: board } = useData(`questions/${g.und}.json`);
  const n = g.items.length;
  const notes = [
    g.estimatedFees && "Some fees are Cowboy's estimates from Derive's schedule, since they were not entered.",
    g.feesMissing && "Some fees were not entered and could not be estimated, so they are left out.",
    g.fromAnswer && "Older positions saved without their filled amounts are drawn from their answer's pay zone.",
    g.partial && "A position that did not fully fill counts only the options that filled.",
  ].filter(Boolean);
  const diff = g.sumTickets - g.mostLose;
  return (
    <article className="q-exp-g" aria-label={`${g.und} on ${dayLabel(g.expiry)}`}>
      <header className="q-exp-gh">
        <h3>{g.und} · {dayLabel(g.expiry)}, 08:00 UTC</h3>
        <span className="q-exp-n">{n} {n === 1 ? "position" : "positions"}<Info label="How these are combined">
          Every open position on {g.und} settling {dayLabel(g.expiry)} at 08:00 UTC, against Derive's {g.ref}, from the exact options and amounts you recorded, after what you paid. The line is the result for each settlement price, not a view of where it settles. {notes.join(" ")}</Info></span>
      </header>
      <ExposureChart und={g.und} index={board?.index} curves={[{ combo: g, label: "What you hold", kind: "held" }]} />
      <dl className="ex-figs">
        <div className="q-lose"><dt>Most you can lose<small>combined, fees included</small></dt><dd className="mono">{amount(g.mostLose)}
          {diff > 0.005 && <small> · tickets one by one {usd(g.sumTickets)}<Info label="Why combined is lower">Added one by one, each ticket's own worst case comes to {usd(g.sumTickets)}. They cannot all be at their worst at one settlement price, so the combined worst case is {amount(g.mostLose)}.</Info></small>}</dd></div>
        <div><dt>Most it pays<small>total back</small></dt><dd className="mono">{amount(g.mostPays)}</dd></div>
        <div><dt>Most you can make<small>after what you paid</small></dt><dd className={`mono ${tone(g.mostMake)}`}>{g.mostMake === Infinity ? "No limit" : g.mostMake > 0.004 ? signed(g.mostMake) : "None"}</dd></div>
        <div><dt>Breakeven</dt><dd className="mono">{breakevenText(g)}</dd></div>
      </dl>
    </article>
  );
}

/** Positions: open exposure by coin and date, and the total most-you-can-lose across dates. */
export default function Exposure({ groups }) {
  if (!groups.length) return null;
  const total = totalMostLose(groups);
  return (
    <section className="q-exp" aria-label="At settlement">
      <div className="q-exp-head">
        <h2>At settlement</h2>
        <span className="q-exp-total">Most you can lose, all dates <b className="mono">{amount(total)}</b>
          <Info label="About the total">Each date settles on its own at 08:00 UTC, so the total is each date's combined worst case added up. Selling back before then is valued at Derive's screen price, not by these lines.</Info></span>
      </div>
      {groups.map((g) => <Group key={g.key} g={g} />)}
    </section>
  );
}
