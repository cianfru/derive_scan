// Saloon cards: a level's price over time, what the last settlement paid, the long shot, and how 55¢ becomes $1.
import { Card, DOWN, LineChart, NAME, TAG, UP, cents, dm, fin, kk as k, pct, stamp, usd, utc, wd, weekday } from "../kit.jsx";

const fridayFirst = (q) => [...(q?.dates || [])].sort((a, b) => (new Date(b.settle_ts * 1000).getUTCDay() === 5) - (new Date(a.settle_ts * 1000).getUTCDay() === 5) || a.settle_ts - b.settle_ts);
const priced = (d) => d.levels.filter((l) => l.yes?.buy && l.no?.buy);
const nearest = (levels, idx) => [...levels].sort((a, b) => Math.abs(a.k - idx) - Math.abs(b.k - idx))[0];

// A level's Higher and Lower prices since its date opened
export function movesModel(q, und) {
  const d = fridayFirst(q).find((x) => priced(x).length >= 3 && x.settle_ts - Date.now() / 1000 > 6 * 3600);
  if (!d) return null;
  return { need: [`questions/history/${und}-${d.expiry}.json`], then: ([h]) => movesFinish(q, und, d, h) };
}

function movesFinish(q, und, d, h) {
  // The level whose Higher price moved most since the date opened, among those still priced near the index.
  const near = priced(d).filter((l) => Math.abs(l.k / q.index - 1) < 0.06 && h?.rows?.[l.id]?.yb?.length >= 6);
  const level = near.sort((a, b) => Math.abs(b.yes.buy - h.rows[b.id].yb[0]) - Math.abs(a.yes.buy - h.rows[a.id].yb[0]))[0];
  const r = level && h.rows[level.id];
  if (!r) return null;
  const pts = (key) => r.i.map((ix, j) => [h.ts[ix], r[key][j]]).filter((p) => fin(p[1]));
  const yb = pts("yb"), nb = pts("nb");
  const i0 = r.i[0];
  return { und, ts: q.prices_ts, settle: d.settle_ts, level, yb, nb, idx0: h.index[i0], idx: q.index, y0: yb[0][1], y1: level.yes.buy, n0: nb[0][1], n1: level.no.buy, t0: h.ts[i0] };
}

function MovesView({ m }) {
  const up = m.y1 >= m.y0;
  const xs = m.yb.map((p) => p[0]);
  return (
    <Card glow={up ? "up" : "down"} stampText={stamp("Derive prices", m.ts)} eyebrow={`${NAME[m.und] || m.und} · ${weekday(m.settle)} ${dm(m.settle)}, 08:00 UTC`}
      title={<>Higher than {usd(m.level.k)}: <span className="mono">{cents(m.y0)}</span> → <span className={`mono ${up ? "g" : "r"}`}>{cents(m.y1)}</span></>}
      sub={<>Since this date opened on {wd(m.t0)} {dm(m.t0)}, {m.und} moved from <b>{k(m.idx0)}</b> to <b>{k(m.idx)}</b> ({pct((m.idx / m.idx0 - 1) * 100)}). Two things move a price: where {m.und} is, and how little time is left for it to change. Every answer pays up to $1.</>}
      tiles={[
        { big: cents(m.y1), text: `Higher now, ${m.y1 >= m.y0 ? "up" : "down"} from ${cents(m.y0)}`, tone: "g" },
        { big: cents(m.n1), text: `Lower now, ${m.n1 >= m.n0 ? "up" : "down"} from ${cents(m.n0)}`, tone: "r" },
        { big: `${k(m.level.lo)}–${k(m.level.hi)}`, text: "where it pays in part" },
      ]}>
      <LineChart id={`mv-${m.und}`} h={340} pad={0.12} series={[{ pts: m.yb, color: UP }, { pts: m.nb, color: DOWN }]} yFmt={(v) => cents(v)}
        xLabels={[[xs[0], `${wd(xs[0])} ${dm(xs[0])}`], [xs.at(-1), "Now"]]}
        marks={[{ x: xs.at(-1), y: m.yb.at(-1)[1], color: UP, label: `Higher ${cents(m.y1)}`, dy: m.y1 >= m.n1 ? -20 : 38 }, { x: xs.at(-1), y: m.nb.at(-1)[1], color: DOWN, label: `Lower ${cents(m.n1)}`, dy: m.n1 > m.y1 ? -20 : 38 }]} />
    </Card>
  );
}

const movesAngles = (m) => [
  `"${m.und} higher than ${usd(m.level.k)} on ${weekday(m.settle)}" cost ${cents(m.y0)} when the date opened. It's ${cents(m.y1)} now, because ${m.und} moved from ${k(m.idx0)} to ${k(m.idx)}. Pays up to $1. Priced from options on ${TAG}.`,
  `Same question, two prices, one week: Higher than ${usd(m.level.k)} went ${cents(m.y0)} → ${cents(m.y1)}, Lower went ${cents(m.n0)} → ${cents(m.n1)}. You don't have to wait for ${weekday(m.settle)}: you can sell back any time. ${TAG}`,
];

// What the last settlement paid, level by level
export function settledModel(q, und) {
  const s = (q?.settled || []).filter((x) => fin(x.settle_price) && x.levels?.length).sort((a, b) => b.settle_ts - a.settle_ts)[0];
  if (!s) return null;
  const levels = [...s.levels].sort((a, b) => Math.abs(a.k - s.settle_price) - Math.abs(b.k - s.settle_price)).slice(0, 7).sort((a, b) => b.k - a.k);
  const part = levels.filter((l) => l.paid > 0.02 && l.paid < 0.98).sort((a, b) => Math.abs(a.paid - 0.5) - Math.abs(b.paid - 0.5))[0];
  return { und, ts: s.settle_ts, label: s.label, settle: s.settle_price, levels, part, zone: s.zone };
}

function SettledView({ m }) {
  return (
    <Card glow="mixed" stampText={stamp("Derive settlement", m.ts)} eyebrow={`${NAME[m.und] || m.und} · settled ${utc(m.ts, { weekday: "long", day: "numeric", month: "short" })}, 08:00 UTC`}
      title={<>{m.und} settled at <span className="mono">{usd(m.settle)}</span>. Here's what every level paid</>} size="m"
      sub={m.part ? <>Inside its zone, an answer pays part of $1. Higher than {usd(m.part.k)} paid <b>{cents(m.part.paid)}</b>: {m.und} settled {Math.round(m.part.paid * 100)}% of the way up its {k(m.part.lo)}–{k(m.part.hi)} zone. Lower paid the rest, {cents(1 - m.part.paid)}.</> : <>Every answer pays up to $1, paid automatically at 08:00 UTC.</>}>
      <div className="xbars">
        {m.levels.map((l) => (
          <div key={l.id} className="xbar" style={{ gridTemplateColumns: "190px 1fr 190px" }}>
            <div className="xbar-l"><span><b>{usd(l.k)}</b><small>{k(l.lo)}–{k(l.hi)}</small></span></div>
            <div className="xbar-t" style={{ display: "flex" }}>
              <i className="fill" style={{ left: 0, width: `${l.paid * 100}%`, background: `linear-gradient(90deg, ${UP}55, ${UP}bb)` }} />
              <i className="fill" style={{ left: `${l.paid * 100}%`, width: `${(1 - l.paid) * 100}%`, background: `linear-gradient(90deg, ${DOWN}bb, ${DOWN}55)` }} />
            </div>
            <div className="xbar-v" style={{ fontSize: 19 }}><span style={{ color: UP }}>{cents(l.paid)}</span> <span style={{ color: "#b9b0a4" }}>/</span> <span style={{ color: DOWN }}>{cents(1 - l.paid)}</span></div>
          </div>
        ))}
      </div>
      <div className="xlegend"><span><i style={{ background: UP }} />Higher paid</span><span><i style={{ background: DOWN }} />Lower paid</span><span>per $1, at settlement</span></div>
    </Card>
  );
}

const settledAngles = (m) => [
  `${m.und} settled at ${usd(m.settle)} on ${m.label}. ${m.part ? `Higher than ${usd(m.part.k)} paid ${cents(m.part.paid)}, Lower paid ${cents(1 - m.part.paid)}: no all-or-nothing, it pays by how far into the zone the price lands.` : ""} Settled by ${TAG}.`,
  m.part ? `Not every answer is all-or-nothing. ${m.und} settled at ${usd(m.settle)}, inside the ${k(m.part.lo)}–${k(m.part.hi)} zone, so "higher than ${usd(m.part.k)}" paid ${cents(m.part.paid)} of every $1. ${TAG}` : null,
].filter(Boolean);

// The long shot: the cheapest answer that still has a price
export function longshotModel(q, und) {
  const d = fridayFirst(q).find((x) => priced(x).length >= 3);
  if (!d) return null;
  const lv = priced(d);
  const hi = lv.filter((l) => l.yes.buy >= 0.05 && l.k > q.index).sort((a, b) => a.yes.buy - b.yes.buy)[0];
  const lo = lv.filter((l) => l.no.buy >= 0.05 && l.k < q.index).sort((a, b) => a.no.buy - b.no.buy)[0];
  if (!hi && !lo) return null;
  return { und, ts: q.prices_ts, idx: q.index, settle: d.settle_ts, hi, lo };
}

function LongshotView({ m }) {
  const side = m.hi && (!m.lo || m.hi.yes.buy <= m.lo.no.buy) ? "hi" : "lo";
  const l = m[side];
  const p = side === "hi" ? l.yes.buy : l.no.buy;
  const full = side === "hi" ? l.hi : l.lo;
  const move = (full / m.idx - 1) * 100;
  return (
    <Card glow={side === "hi" ? "up" : "down"} stampText={stamp("Derive prices", m.ts)} eyebrow={`${NAME[m.und] || m.und} · ${weekday(m.settle)} ${dm(m.settle)}`}
      title={<><span className="mono">{cents(p)}</span> to win up to <span className="mono">$1</span>: {m.und} needs <span className={`mono ${side === "hi" ? "g" : "r"}`}>{pct(move)}</span> by {weekday(m.settle)}</>} size="m"
      sub={<>{side === "hi" ? "Higher" : "Lower"} than {usd(l.k)} costs {cents(p)} today. It pays the full $1 if {m.und} is {side === "hi" ? "at or above" : "at or below"} <b>{usd(full)}</b> at settlement, part of it inside the zone, and nothing {side === "hi" ? "below" : "above"} <b>{usd(side === "hi" ? l.lo : l.hi)}</b>.</>}
      tiles={[
        { big: `${(1 / p).toFixed(1)}×`, text: "the most it pays back, before fees", tone: side === "hi" ? "g" : "r" },
        { big: usd(m.idx), text: `${m.und} now` },
        { big: "Only " + cents(p), mono: false, text: "is the most you can lose per $1" },
      ]}>
      <div className="xgauge" style={{ justifyContent: "center", gap: 36 }}>
        {[["Now", m.idx], [side === "hi" ? "Starts paying" : "Starts paying", side === "hi" ? l.lo : l.hi], ["Pays in full", full]].map(([t, v], i) => (
          <div key={t + i} className="glass" style={{ padding: "22px 26px", minWidth: 250, textAlign: "center" }}>
            <div style={{ font: "500 16px Manrope", color: "#c6beb2" }}>{t}</div>
            <div style={{ font: "700 40px 'Chivo Mono'", letterSpacing: "-.05em", marginTop: 8, color: i === 2 ? (side === "hi" ? UP : DOWN) : "#f7f3ed" }}>{usd(v)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const longshotAngles = (m) => {
  const side = m.hi && (!m.lo || m.hi.yes.buy <= m.lo.no.buy) ? "hi" : "lo";
  const l = m[side], p = side === "hi" ? l.yes.buy : l.no.buy, full = side === "hi" ? l.hi : l.lo;
  return [
    `Long shot of the week: ${cents(p)} buys "${m.und} ${side === "hi" ? "higher" : "lower"} than ${usd(l.k)} on ${weekday(m.settle)}". Full $1 if it settles ${side === "hi" ? "at or above" : "at or below"} ${usd(full)}, ${Math.abs((full / m.idx - 1) * 100).toFixed(1)}% ${full > m.idx ? "above" : "below"} today. Worst case: you lose the ${cents(p)}. Prices from ${TAG}.`,
    `What does ${cents(p)} buy? A ${(1 / p).toFixed(0)}× payout if ${m.und} ${full > m.idx ? "rises" : "falls"} ${Math.abs((full / m.idx - 1) * 100).toFixed(1)}% by ${weekday(m.settle)} 08:00 UTC. Cheap because it's far, not because it's free. ${TAG}`,
  ];
};

// How 55¢ turns into $1: the payout line of the level closest to the price
export function explainModel(q, und) {
  const d = fridayFirst(q).find((x) => priced(x).length >= 3);
  if (!d) return null;
  const l = nearest(priced(d), q.index);
  return { und, ts: q.prices_ts, idx: q.index, settle: d.settle_ts, l, p: l.yes.buy, be: l.lo + l.yes.buy * (l.hi - l.lo) };
}

function ExplainView({ m }) {
  const { l } = m;
  const pad = (l.hi - l.lo) * 0.45;
  const pts = [[l.lo - pad, 0], [l.lo, 0], [l.hi, 1], [l.hi + pad, 1]];
  return (
    <Card glow="up" stampText={stamp("Derive prices", m.ts)} eyebrow={`How it works · ${m.und} ${weekday(m.settle)}`}
      title={<>How <span className="mono g">{cents(m.p)}</span> turns into <span className="mono">$1</span></>}
      sub={<>"{m.und} higher than {usd(l.k)}" costs {cents(m.p)}. Below {usd(l.lo)} it pays nothing. Above {usd(l.hi)} it pays the full $1. In between, it climbs one step at a time. You never owe more than you paid.</>}
      tiles={[
        { big: "$0", text: `if ${m.und} settles below ${usd(l.lo)}`, tone: "r" },
        { big: usd(m.be), text: "where you get your money back" },
        { big: "$1", text: `if it settles above ${usd(l.hi)}`, tone: "g" },
      ]}>
      <LineChart id={`ex-${m.und}`} h={330} yMin={0} yMax={1} pad={0.06} series={[{ pts, color: UP, width: 4, area: true }, { pts: [[pts[0][0], m.p], [pts.at(-1)[0], m.p]], color: "#ffffff", width: 2, dash: "6 8", glow: false }]}
        yFmt={(v) => (v < 0.02 ? "$0" : v > 0.98 ? "$1" : cents(v))} xLabels={[[pts[0][0], k(pts[0][0])], [l.lo, k(l.lo)], [l.hi, k(l.hi)], [pts.at(-1)[0], k(pts.at(-1)[0])]]}
        marks={[{ x: m.idx, y: Math.min(1, Math.max(0, (m.idx - l.lo) / (l.hi - l.lo))), label: `Now ${k(m.idx)}`, color: "#ffffff" }, { x: m.be, y: m.p, color: "#ffffff", label: `You pay ${cents(m.p)}`, anchor: "start", dx: 18, dy: 30 }]} />
    </Card>
  );
}

const explainAngles = (m) => [
  `How a ${cents(m.p)} answer pays $1: "${m.und} higher than ${usd(m.l.k)} on ${weekday(m.settle)}". Below ${k(m.l.lo)}: $0. Above ${k(m.l.hi)}: $1. In between it pays in part, and you get your money back at ${usd(m.be)}. Built from options on ${TAG}.`,
  `The most you can lose is what you pay. That's the whole rule. ${cents(m.p)} on "${m.und} higher than ${usd(m.l.k)}" pays up to $1 at ${weekday(m.settle)}'s 08:00 UTC settlement, and you can sell back before. Options on ${TAG} under the hood.`,
];

export const SALOON = [
  { id: "moves", group: "Saloon", title: "How a price moved", params: ["BTC", "ETH"], files: (u) => [`questions/${u}.json`], model: ([q], u) => movesModel(q, u), View: MovesView, angles: movesAngles },
  { id: "settled", group: "Saloon", title: "What settlement paid", params: ["BTC", "ETH"], files: (u) => [`questions/${u}.json`], model: ([q], u) => settledModel(q, u), View: SettledView, angles: settledAngles },
  { id: "longshot", group: "Saloon", title: "The long shot", params: ["BTC", "ETH"], files: (u) => [`questions/${u}.json`], model: ([q], u) => longshotModel(q, u), View: LongshotView, angles: longshotAngles },
  { id: "explain", group: "Saloon", title: "How 55¢ becomes $1", params: ["BTC", "ETH"], files: (u) => [`questions/${u}.json`], model: ([q], u) => explainModel(q, u), View: ExplainView, angles: explainAngles },
];
