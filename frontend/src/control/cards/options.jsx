// Options cards in plain words: what protection costs, the swing options price, where open bets sit,
// calls against puts, how far each date is priced, and what traders did in the last 24 hours.
import { Bars, Card, DOWN, GREY, LineChart, NAME, TAG, UP, agoText, an, big, dm, fin, hourly, kk as k, pct, price, rankShare, stamp, strikeLabel, usd, valueAgo, wd } from "../kit.jsx";

const DAY = 86400;
const swingOf = (iv, days) => iv * Math.sqrt(days / 365) * 100;

// What protection against a drop costs next to a bet on a rise, over the last two weeks
export function insuranceModel(coin, und) {
  const h = (coin?.options?.iv_history || []).filter((r) => fin(r[2]) && fin(r[4]) && r[2] > 0);
  if (h.length < 20) return null;
  const pts = hourly(h.map((r) => [r[0], (-r[4] / r[2]) * 100]));
  const now = pts.at(-1)[1];
  const wk = valueAgo(pts, 7 * DAY);
  return { und, ts: coin.options.ts, pts, now, week: wk?.[1], weekAgo: wk ? agoText(wk[0], pts.at(-1)[0]) : null, share: rankShare(pts.map((p) => p[1])), days: Math.round((pts.at(-1)[0] - pts[0][0]) / DAY) };
}

const protWord = (v) => (v > 0 ? "drops" : "rises");

function InsuranceView({ m }) {
  const drops = m.now > 0;
  const xs = m.pts.map((p) => p[0]);
  return (
    <Card glow={drops ? "down" : "up"} stampText={stamp("Derive options", m.ts)} eyebrow={`${NAME[m.und] || m.und} · options, next 30 days`}
      title={<>Protecting against {an(m.und)} {m.und} <span className={drops ? "r" : "g"}>{drops ? "drop" : "rise"}</span> costs <span className="mono">{Math.abs(m.now).toFixed(Math.abs(m.now) < 10 ? 1 : 0)}%</span> more than the opposite</>}
      sub={<>Every option is insurance for someone. When protection against a fall costs more than a bet on a rise, traders are paying up to hedge. {m.share != null ? <>The gap is wider than <b>{drops ? m.share : 100 - m.share}%</b> of the time over the last {m.days} days.</> : null}</>}
      tiles={[
        { big: `${Math.abs(m.now).toFixed(1)}%`, text: `extra paid to protect against ${protWord(m.now)}`, tone: drops ? "r" : "g" },
        fin(m.week) ? { big: `${Math.abs(m.week).toFixed(1)}%`, text: `${m.weekAgo}, for ${protWord(m.week)}` } : null,
        { big: drops ? "Hedging" : "Chasing", mono: false, text: drops ? "the side traders are paying for" : "traders pay more for upside", tone: drops ? "r" : "g" },
      ].filter(Boolean)}>
      <LineChart id={`ins-${m.und}`} h={340} zero={0} series={[{ pts: m.pts, color: drops ? DOWN : UP, area: true }]}
        yFmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} xLabels={[[xs[0], dm(xs[0])], [xs.at(-1), "Now"]]}
        marks={[{ x: xs.at(-1), y: m.now, color: drops ? DOWN : UP }]} />
      <div className="xlegend"><span>Above the dashed line: drops cost more to protect against. Below: rises do.</span></div>
    </Card>
  );
}

const insuranceAngles = (m) => {
  const drops = m.now > 0, side = drops ? "drop" : "rise";
  return [
    `Insurance against ${an(m.und)} ${m.und} ${side} costs ${Math.abs(m.now).toFixed(1)}% more than a bet on the opposite move, on ${TAG} options. ${m.share != null ? `The gap is wider than ${drops ? m.share : 100 - m.share}% of the time over the last ${m.days} days.` : ""} Traders are paying for ${drops ? "safety" : "upside"}.`,
    fin(m.week) ? `${m.weekAgo[0].toUpperCase() + m.weekAgo.slice(1)}, protecting against ${an(m.und)} ${m.und} ${protWord(m.week).slice(0, -1)} cost ${Math.abs(m.week).toFixed(1)}% extra. Today: ${Math.abs(m.now).toFixed(1)}% for a ${side}. When this number moves, traders are changing what they fear. ${TAG}` : null,
    `Why do ${m.und} puts usually cost more than calls? Because people who hold ${m.und} buy protection, and there's always more fear of a crash than of a rally. Today the premium is ${Math.abs(m.now).toFixed(1)}% on the ${side} side. ${TAG}`,
  ].filter(Boolean);
};

// The swing a normal month is priced at, and how it moved
export function swingModel(coin, und) {
  const f = coin?.options?.features;
  const h = (coin?.options?.iv_history || []).filter((r) => fin(r[2]));
  if (!fin(f?.atm_iv_30d) || h.length < 20) return null;
  const pts = hourly(h.map((r) => [r[0], swingOf(r[2], 30)]));
  const now = swingOf(f.atm_iv_30d, 30);
  const wkp = valueAgo(pts, 7 * DAY);
  return {
    und, ts: coin.options.ts, spot: f.index_price, pts, now, week: wkp?.[1], weekAgo: wkp ? agoText(wkp[0], pts.at(-1)[0]) : null,
    w7: fin(f.atm_iv_7d) ? swingOf(f.atm_iv_7d, 7) : null, q90: fin(f.atm_iv_90d) ? swingOf(f.atm_iv_90d, 90) : null,
    lo: Math.min(...pts.map((p) => p[1])), hi: Math.max(...pts.map((p) => p[1])), days: Math.round((pts.at(-1)[0] - pts[0][0]) / DAY),
  };
}

function SwingView({ m }) {
  const cheaper = fin(m.week) && m.now < m.week;
  const xs = m.pts.map((p) => p[0]);
  return (
    <Card glow="calm" stampText={stamp("Derive options", m.ts)} eyebrow={`${NAME[m.und] || m.und} · what options price`}
      title={<>Options price a <span className="mono">±{m.now.toFixed(1)}%</span> month for {m.und}{fin(m.week) ? <>, {cheaper ? "down" : "up"} from <span className="mono">±{m.week.toFixed(1)}%</span> {m.weekAgo}</> : null}</>}
      sub={<>That's a normal month's move, as option prices see it: from {m.und} at <b>{k(m.spot)}</b>, about <b>{k(m.spot * (1 - m.now / 100))}</b> to <b>{k(m.spot * (1 + m.now / 100))}</b>. {cheaper ? "Options got cheaper: traders are paying less for big moves." : "Options got pricier: traders are paying more for big moves."}</>}
      tiles={[
        m.w7 != null ? { big: `±${m.w7.toFixed(1)}%`, text: "a normal week" } : null,
        { big: `±${m.now.toFixed(1)}%`, text: "a normal month" },
        m.q90 != null ? { big: `±${m.q90.toFixed(0)}%`, text: "a normal three months" } : null,
      ].filter(Boolean)}>
      <LineChart id={`sw-${m.und}`} h={340} series={[{ pts: m.pts, color: "#c8b8ff", area: true }]} yFmt={(v) => `±${v.toFixed(1)}%`}
        xLabels={[[xs[0], dm(xs[0])], [xs.at(-1), "Now"]]} marks={[{ x: xs.at(-1), y: m.pts.at(-1)[1], color: "#c8b8ff", label: `±${m.now.toFixed(1)}%` }]} />
    </Card>
  );
}

const swingAngles = (m) => {
  const cheaper = fin(m.week) && m.now < m.week;
  return [
    `Options on ${TAG} price a normal month for ${m.und} at ±${m.now.toFixed(1)}%: roughly ${k(m.spot * (1 - m.now / 100))} to ${k(m.spot * (1 + m.now / 100))}. ${fin(m.week) ? `${m.weekAgo[0].toUpperCase() + m.weekAgo.slice(1)} it was ±${m.week.toFixed(1)}%. ${cheaper ? "Cheaper options, calmer traders." : "Pricier options, more nervous traders."}` : ""}`,
    `Over the last ${m.days} days, the cheapest ${m.und} options priced a month at ±${m.lo.toFixed(1)}%, the priciest at ±${m.hi.toFixed(1)}%. Today: ±${m.now.toFixed(1)}%. Options are cheap when nobody's worried, which is exactly when people forget to hedge. ${TAG}`,
    m.w7 != null ? `How far ${m.und} moves in a normal week, priced by options on ${TAG}: ±${m.w7.toFixed(1)}%. A month: ±${m.now.toFixed(1)}%. Three months: ±${(m.q90 ?? 0).toFixed(0)}%. Moves grow with time, but slower than you'd think.` : null,
  ].filter(Boolean);
};

// Where the open bets sit over the next 30 days
export function pileModel(coin, und) {
  const s = coin?.options?.strikes;
  const lv = coin?.options?.levels;
  if (!s?.expiries || !fin(s.index)) return null;
  const until = s.ts + 31 * DAY;
  const by = new Map();
  for (const [exp, rows] of Object.entries(s.expiries)) {
    if (Number(exp) > until) continue;
    for (const [strike, c, p] of rows) {
      const cur = by.get(strike) || [0, 0];
      by.set(strike, [cur[0] + (c || 0), cur[1] + (p || 0)]);
    }
  }
  const all = [...by.entries()].map(([strike, [c, p]]) => ({ strike, c: c * s.index, p: p * s.index })).filter((r) => r.c + r.p > 0);
  if (all.length < 5) return null;
  const near = all.filter((r) => Math.abs(r.strike / s.index - 1) < 0.2).sort((a, b) => a.strike - b.strike);
  const top = [...all].sort((a, b) => b.c + b.p - (a.c + a.p))[0];
  const calls = all.reduce((t, r) => t + r.c, 0), puts = all.reduce((t, r) => t + r.p, 0);
  return { und, ts: s.ts, spot: s.index, rows: near, top, calls, puts, callWall: lv?.call_wall, putWall: lv?.put_wall };
}

function PileView({ m }) {
  const W = 964, H = 380, mid = H * 0.56;
  const max = Math.max(...m.rows.map((r) => Math.max(r.c, r.p)), 1);
  const bw = W / m.rows.length;
  const xSpot = m.rows.findIndex((r) => r.strike >= m.spot);
  const labelEvery = Math.ceil(m.rows.length / 8);
  return (
    <Card glow="mixed" stampText={stamp("Derive options", m.ts)} eyebrow={`${NAME[m.und] || m.und} · open options, next 30 days`}
      title={<><span className="mono">{big(m.top.c + m.top.p)}</span> of {m.und} options sit at <span className="mono">{usd(m.top.strike)}</span></>}
      sub={<>Open bets pile up at round numbers. Green bars are calls, paying if {m.und} ends above that price; red bars are puts, paying if it ends below. {m.und} is at <b>{price(m.spot)}</b> now.</>}
      tiles={[
        m.callWall ? { big: usd(m.callWall), text: "the biggest pile of calls", tone: "g" } : null,
        m.putWall ? { big: usd(m.putWall), text: "the biggest pile of puts", tone: "r" } : null,
        { big: m.puts > 0 ? `${(m.calls / m.puts).toFixed(1)}×` : "All calls", text: "as much in calls as in puts" },
      ].filter(Boolean)}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H + 30}`} preserveAspectRatio="xMidYMid meet">
        {m.rows.map((r, i) => (
          <g key={r.strike}>
            <rect x={i * bw + 2} y={mid - (r.c / max) * (mid - 10)} width={bw - 4} height={(r.c / max) * (mid - 10)} rx="3" fill={UP} opacity=".75" />
            <rect x={i * bw + 2} y={mid + 4} width={bw - 4} height={(r.p / max) * (H - mid - 10)} rx="3" fill={DOWN} opacity=".75" />
            {i % labelEvery === 0 ? <text x={i * bw + bw / 2} y={H + 24} textAnchor="middle" fill="#b9b0a4" fontFamily="Chivo Mono" fontSize="15">{strikeLabel(r.strike)}</text> : null}
          </g>
        ))}
        <line x1="0" x2={W} y1={mid + 2} y2={mid + 2} stroke="rgba(255,255,255,.18)" />
        {xSpot > 0 ? <g><line x1={xSpot * bw} x2={xSpot * bw} y1="0" y2={H} stroke="#fff" strokeOpacity=".7" strokeDasharray="4 6" /><text x={xSpot * bw + 8} y="18" fill="#fff" fontFamily="Chivo Mono" fontSize="16" fontWeight="700">Now {price(m.spot)}</text></g> : null}
      </svg>
    </Card>
  );
}

const pileAngles = (m) => [
  `The biggest pile of open ${m.und} options on ${TAG} sits at ${usd(m.top.strike)}: ${big(m.top.c + m.top.p)} worth. ${m.und} is at ${price(m.spot)}. Big piles like this are where traders have the most riding on the outcome.`,
  m.callWall && m.putWall ? `Over the next 30 days, the most ${m.und} calls on ${TAG} sit at ${usd(m.callWall)} and the most puts at ${usd(m.putWall)}. Between those two lines is where most of the open bets live.` : null,
  m.puts > 0 ? `For every $1 of ${m.und} puts open on ${TAG}, there are $${(m.calls / m.puts).toFixed(1)} of calls. Calls pay if price rises past a level, puts if it falls below. Here's where each one sits.` : null,
].filter(Boolean);

// How far each date is priced: the middle half of outcomes, by expiry
export function termModel(coin, und) {
  const o = coin?.options;
  const spot = o?.features?.index_price;
  const rows = (o?.implied || []).filter((e) => e.q?.length === 5 && e.days <= 100).map((e) => ({ expiry: e.expiry, days: e.days, lo: e.q[1], hi: e.q[3], w: ((e.q[3] - e.q[1]) / 2 / spot) * 100 }));
  if (!fin(spot) || rows.length < 4) return null;
  return { und, ts: o.ts, spot, rows: rows.slice(0, 9) };
}

function TermView({ m }) {
  const max = Math.max(...m.rows.map((r) => r.w));
  const first = m.rows[0], last = m.rows.at(-1);
  return (
    <Card glow="calm" stampText={stamp("Derive options", m.ts)} eyebrow={`${NAME[m.und] || m.und} · priced range by date`}
      title={<>How far {m.und} moves, by date: <span className="mono">±{first.w.toFixed(1)}%</span> by {wd(first.expiry)}, <span className="mono">±{last.w.toFixed(0)}%</span> by {dm(last.expiry)}</>} size="m"
      sub={<>Each bar is the middle half of the outcomes option traders are paying for on that date. Time does the work: the further out, the wider it gets.</>}>
      <div className="xbars">
        {m.rows.map((r) => (
          <div key={r.expiry} className="xbar" style={{ gridTemplateColumns: "150px 1fr 250px" }}>
            <div className="xbar-l"><span><b>{dm(r.expiry)}</b><small>{r.days < 1.5 ? "tomorrow" : `${Math.round(r.days)} days`}</small></span></div>
            <div className="xbar-t">
              <i className="axis" />
              <i className="fill" style={{ left: `${50 - (r.w / max) * 48}%`, width: `${(r.w / max) * 48}%`, background: `linear-gradient(90deg, ${DOWN}aa, ${DOWN}33)` }} />
              <i className="fill" style={{ left: "50%", width: `${(r.w / max) * 48}%`, background: `linear-gradient(90deg, ${UP}33, ${UP}aa)` }} />
            </div>
            <div className="xbar-v" style={{ fontSize: 18, color: "#f7f3ed" }}>{k(r.lo)} – {k(r.hi)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const termAngles = (m) => {
  const [a, b] = [m.rows[0], m.rows.at(-1)];
  return [
    `How far ${m.und} moves, priced by options on ${TAG}: ±${a.w.toFixed(1)}% by ${dm(a.expiry)}, ±${b.w.toFixed(0)}% by ${dm(b.expiry)}. Each bar is the middle half of the outcomes traders are paying for.`,
    `${m.und} at ${k(m.spot)}. Options on ${TAG} put the middle half of outcomes for ${dm(b.expiry)} between ${k(b.lo)} and ${k(b.hi)}. Not a forecast: it's what people pay to be protected either way.`,
  ];
};

// The last 24 hours of options flow, in plain directions
export function flowModel(coin, und) {
  const f = coin?.taker_flow?.["24h"];
  if (!f?.call || !f?.put) return null;
  const cb = f.call.buy_notional_usd || 0, cs = f.call.sell_notional_usd || 0, pb = f.put.buy_notional_usd || 0, ps = f.put.sell_notional_usd || 0;
  const total = cb + cs + pb + ps;
  if (total < 50_000) return null;
  const upLean = cb + ps, down = pb + cs;
  return { und, ts: coin.options?.ts || coin.generated_at, cb, cs, pb, ps, total, upShare: Math.round((upLean / total) * 100) };
}

function FlowView({ m }) {
  const up = m.upShare >= 50;
  const rows = [
    { label: "Calls bought", sub: "pays if it rises", value: m.cb, color: UP },
    { label: "Puts sold", sub: "paid to accept a fall", value: m.ps, color: UP },
    { label: "Puts bought", sub: "protection against a fall", value: m.pb, color: DOWN },
    { label: "Calls sold", sub: "paid to give up a rise", value: m.cs, color: DOWN },
  ].map((r) => ({ ...r, text: big(r.value) }));
  return (
    <Card glow={up ? "up" : "down"} stampText={stamp("Derive trades", m.ts)} eyebrow={`${NAME[m.und] || m.und} · options traded, last 24 hours`}
      title={<><span className={`mono ${up ? "g" : "r"}`}>{up ? m.upShare : 100 - m.upShare}%</span> of today's {m.und} options flow leaned {up ? "up" : "down"}</>}
      sub={<>Buying calls and selling puts both win if {m.und} rises; buying puts and selling calls win if it falls or stays capped. <b>{big(m.total)}</b> traded in a day, counted from the side that started each trade.</>}>
      <Bars rows={rows} />
    </Card>
  );
}

const flowAngles = (m) => {
  const up = m.upShare >= 50;
  const lead = [["bought", m.cb, "calls"], ["sold", m.ps, "puts"], ["bought", m.pb, "puts"], ["sold", m.cs, "calls"]].sort((a, b) => b[1] - a[1])[0];
  return [
    `${up ? m.upShare : 100 - m.upShare}% of the last 24 hours of ${m.und} options flow on ${TAG} leaned ${up ? "up" : "down"}. Biggest single habit: traders ${lead[0]} ${big(lead[1])} of ${lead[2]}.`,
    m.ps > m.pb ? `Traders sold ${big(m.ps)} of ${m.und} puts in the last 24 hours and bought ${big(m.pb)}. Selling a put means getting paid to promise you'd buy lower: people comfortable with the price. ${TAG}` : `Traders bought ${big(m.pb)} of ${m.und} puts in 24 hours and sold ${big(m.ps)}. Buying puts is buying insurance against a fall. Someone's hedging. ${TAG}`,
  ];
};

export const OPTIONS = [
  { id: "insurance", group: "Options", title: "Protection cost", params: ["BTC", "ETH"], files: (u) => [`coins/${u}.json`], model: ([c], u) => insuranceModel(c, u), View: InsuranceView, angles: insuranceAngles },
  { id: "swing", group: "Options", title: "A normal month's swing", params: ["BTC", "ETH", "HYPE"], files: (u) => [`coins/${u}.json`], model: ([c], u) => swingModel(c, u), View: SwingView, angles: swingAngles },
  { id: "pile", group: "Options", title: "Where the open bets sit", params: ["BTC", "ETH", "HYPE", "SOL"], files: (u) => [`coins/${u}.json`], model: ([c], u) => pileModel(c, u), View: PileView, angles: pileAngles },
  { id: "term", group: "Options", title: "Priced range by date", params: ["BTC", "ETH"], files: (u) => [`coins/${u}.json`], model: ([c], u) => termModel(c, u), View: TermView, angles: termAngles },
  { id: "flow", group: "Options", title: "Last 24 hours of flow", params: ["BTC", "ETH", "HYPE"], files: (u) => [`coins/${u}.json`], model: ([c], u) => flowModel(c, u), View: FlowView, angles: flowAngles },
];

export { GREY };
