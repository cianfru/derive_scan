// X cards for the control page: each card builds a model from published files,
// draws it at 1080x1080 and drafts the post text. Plain words for retail, no forecast words.

const NAME = { ADA: "Cardano", BTC: "Bitcoin", CC: "Canton", ETH: "Ethereum", HYPE: "Hyperliquid", LIT: "Lighter", PUMP: "Pump", SOL: "Solana", VVV: "Venice", XAUT: "Tether Gold", XRP: "XRP", ZEC: "Zcash", BNB: "BNB", DOGE: "Dogecoin", LINK: "Chainlink" };
const REG = { MARKUP: "Trending up", REACC: "Cooling off", ACCUM: "Building a base", MARKDOWN: "Trending down", BLOWOFF: "Overheated", CAP: "Washed out" };
const ICON = { CC: "CC.png", HYPE: "HYPE.jpg", LIT: "LIT.png", PUMP: "PUMP.jpg", VVV: "VVV.png" };
export const TAG = "@derivexyz";

const k = (v) => `$${(v / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const cents = (p) => `${Math.round(p * 100)}¢`;
const utc = (t, opts) => new Date(t * 1000).toLocaleString("en-GB", { timeZone: "UTC", ...opts });
const dm = (t) => utc(t, { day: "numeric", month: "short" });
const weekday = (t) => utc(t, { weekday: "long" });
const stampText = (src, t) => `${src} · ${dm(t)}, ${utc(t, { hour: "2-digit", minute: "2-digit", hour12: false })} UTC`;
const join = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function Frame({ kind, stamp, footRight, children }) {
  return (
    <div className={`xc xc-${kind}`}>
      <div className="grain" />
      <div className="frame" />
      <div className="top"><img src="/brand/cowboy-lockup-on-dark.svg" alt="Cowboy" /><span className="stamp">{stamp}</span></div>
      {children}
      <div className="foot"><span><b>cowboy.trading</b></span><span>{footRight}</span></div>
    </div>
  );
}

// 1. The range BTC options price for Friday.
export function rangeModel(coin, und = "BTC") {
  const o = coin?.options;
  const candles = coin?.candles?.["1d"];
  if (!o?.implied?.length || !candles?.length) return null;
  const spot = o.features.index_price;
  const now = o.ts;
  const fridays = o.implied.filter((e) => new Date(e.expiry * 1000).getUTCDay() === 5 && e.days < 30 && e.q?.length === 5);
  if (!fridays.length || !spot) return null;
  return {
    und, spot, now,
    hist: [...candles.slice(-30).map((c) => [c[0] + 86400, c[4]]), [now, spot]],
    cone: [[now, [spot, spot, spot, spot, spot]], ...fridays.map((e) => [e.expiry, e.q])],
    head: fridays[0],
    swing: o.features.atm_iv_30d * Math.sqrt(30 / 365) * 100,
    skew: o.features.rr25_30d,
    wall: o.levels?.call_wall,
  };
}

const AX = { fill: "#b9b0a4", fontFamily: "Chivo Mono", fontSize: 15 };
const PT = { fontFamily: "Chivo Mono", fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em" };

function RangeCard({ m }) {
  const [X0, X1, Y0, Y1] = [70, 860, 440, 790];
  const t0 = m.hist[0][0], t1 = m.cone.at(-1)[0];
  const vals = [...m.hist.map((p) => p[1]), ...m.cone.flatMap(([, q]) => [q[0], q[4]])];
  const lo = Math.min(...vals) * 0.99, hi = Math.max(...vals) * 1.01;
  const X = (t) => X0 + ((t - t0) / (t1 - t0)) * (X1 - X0);
  const Y = (v) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
  const path = (pts) => "M" + pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" L");
  const band = (i, j) => path([...m.cone.map(([t, q]) => [t, q[j]]), ...[...m.cone].reverse().map(([t, q]) => [t, q[i]])]) + " Z";
  const edge = (i) => path(m.cone.map(([t, q]) => [t, q[i]]));
  const area = path(m.hist) + ` L${X(m.now).toFixed(1)},${Y1} L${X(t0).toFixed(1)},${Y1} Z`;
  const step = (hi - lo) > 40000 ? 10000 : 5000;
  const grid = [];
  for (let g = Math.ceil(lo / step) * step; g < hi; g += step) grid.push(g);
  const e0 = m.cone[1];
  const down = m.skew < 0;
  return (
    <Frame kind="range" stamp={stampText("Derive options", m.now)} footRight="What option prices imply, not a forecast · Not investment advice">
      <div className="eyebrow">{NAME[m.und] || m.und} · {weekday(m.head.expiry)} {dm(m.head.expiry)}</div>
      <h1>Options traders price {m.und} between <span className="n r">{k(m.head.q[1])}</span> and <span className="n g">{k(m.head.q[3])}</span> on {weekday(m.head.expiry)}</h1>
      <div className="sub">That's the middle half of the outcomes they're paying for. {m.und} is at <b>{k(m.spot)}</b> now, and the range gets wider the further out you look.</div>
      <svg width="1080" height="1080" viewBox="0 0 1080 1080">
        <defs>
          <linearGradient id="xr-gu" x1="0" x2="1"><stop offset="0" stopColor="#8ff0c6" stopOpacity=".08" /><stop offset="1" stopColor="#8ff0c6" stopOpacity=".42" /></linearGradient>
          <linearGradient id="xr-gd" x1="0" x2="1"><stop offset="0" stopColor="#ff9d90" stopOpacity=".08" /><stop offset="1" stopColor="#ff9d90" stopOpacity=".42" /></linearGradient>
          <linearGradient id="xr-ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".16" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
          <filter id="xr-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        {grid.map((g) => (
          <g key={g}><line x1={X0} x2={X1} y1={Y(g)} y2={Y(g)} stroke="rgba(255,255,255,.07)" /><text x={X1 + 12} y={Y(g) + 5} {...AX}>{k(g)}</text></g>
        ))}
        {m.cone.slice(1).map(([t], i) => (
          <g key={t}><line x1={X(t)} x2={X(t)} y1={Y0 - 10} y2={Y1} stroke="rgba(255,255,255,.14)" strokeDasharray="2 6" /><text x={X(t)} y={Y1 + 28} {...AX} textAnchor="middle">{i === 0 ? "Fri " : ""}{dm(t)}</text></g>
        ))}
        <path d={area} fill="url(#xr-ga)" />
        <path d={band(2, 4)} fill="url(#xr-gu)" opacity=".5" /><path d={band(0, 2)} fill="url(#xr-gd)" opacity=".5" />
        <path d={band(2, 3)} fill="url(#xr-gu)" /><path d={band(1, 2)} fill="url(#xr-gd)" />
        <path d={edge(3)} fill="none" stroke="#8ff0c6" strokeWidth="7" opacity=".35" filter="url(#xr-glow)" />
        <path d={edge(1)} fill="none" stroke="#ff9d90" strokeWidth="7" opacity=".35" filter="url(#xr-glow)" />
        <path d={edge(3)} fill="none" stroke="#8ff0c6" strokeWidth="3" />
        <path d={edge(1)} fill="none" stroke="#ff9d90" strokeWidth="3" />
        <path d={path(m.hist)} fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinejoin="round" />
        <circle cx={X(m.now)} cy={Y(m.spot)} r="14" fill="#ffffff" opacity=".15" /><circle cx={X(m.now)} cy={Y(m.spot)} r="7" fill="#ffffff" />
        <text x={X(m.now) - 16} y={Y(m.spot) - 20} {...AX} fill="#ffffff" fontWeight="600" textAnchor="end">Now</text>
        <text x={X0} y={Y1 + 28} {...AX}>{dm(t0)}</text>
        <text x={X(e0[0]) + 4} y={Y(e0[1][3]) - 30} {...PT} fill="#8ff0c6">{k(e0[1][3])}</text>
        <text x={X(e0[0]) + 4} y={Y(e0[1][1]) + 46} {...PT} fill="#ff9d90">{k(e0[1][1])}</text>
      </svg>
      <div className="tiles">
        <div className="tile glass"><b>±{Math.round(m.swing)}%</b><span>A normal month's swing for {m.und}, as options price it</span></div>
        <div className={`tile glass ${down ? "r" : "g"}`}><b>{down ? "Drops" : "Rises"}</b><span>cost more to protect against than {down ? "rises" : "drops"}</span></div>
        {m.wall ? <div className="tile glass"><b>{usd(m.wall)}</b><span>Where the most open bets on {m.und} sit</span></div> : null}
      </div>
    </Frame>
  );
}

const rangeText = (m) =>
  `Options traders on ${TAG} price ${m.und} between ${k(m.head.q[1])} and ${k(m.head.q[3])} for ${weekday(m.head.expiry)}. ` +
  `That's the middle half of what they're paying for. ${m.skew < 0 ? "Drops cost more to protect against than rises" : "Rises cost more to protect against than drops"} right now.`;

// 2. The herd: how every coin with options reads over the next 30 days.
export function herdModel(markets) {
  const coins = (markets?.coins || []).filter((c) => c.has_options);
  if (coins.length < 4) return null;
  const st = (c, key) => c.align?.readings?.["30d"]?.[key]?.state ?? null;
  const agree = (c) => ["engine", "wallets", "options"].every((key) => st(c, key) === "up");
  const rows = coins.map((c) => ({ und: c.und, chg: c.chg_7d || 0, regime: c.regime_1d, all: agree(c), engine: st(c, "engine"), wallets: st(c, "wallets"), options: st(c, "options") }));
  rows.sort((a, b) => (b.all - a.all) || ((b.regime === "MARKUP") - (a.regime === "MARKUP")) || (b.chg - a.chg));
  return { ts: markets.generated_at, rows: rows.slice(0, 12), total: coins.length, up: coins.filter((c) => c.regime_1d === "MARKUP").length, both: rows.filter((r) => r.all).map((r) => r.und) };
}

function Dot({ s, label }) {
  const cls = { up: "u", defensive: "d", neutral: "z" }[s] || "x";
  return <span className={`dot ${cls}`}><i />{label}</span>;
}

function HerdCard({ m }) {
  const most = m.up * 2 >= m.total;
  return (
    <Frame kind="herd" stamp={stampText("Derive data", m.ts)} footRight="What the data shows today · Not investment advice">
      <div className="eyebrow">Derive options markets · next 30 days</div>
      <h1>{m.up} of {m.total} coins are <span className={most ? "g" : ""}>trending up</span></h1>
      <div className="sub">Three things we watch for every coin: the engine's price signal, how smart wallets are positioned, and what options traders pay for. {m.both.length ? <>On <b>{join(m.both)}</b> all three point up.</> : "Today no coin has all three pointing up."}</div>
      <div className="grid">
        {m.rows.map((c) => (
          <div key={c.und} className={`tile glass${c.all ? " all" : ""}`}>
            <div className="row1">
              <img src={`/coins/${ICON[c.und] || c.und + ".svg"}`} alt="" />
              <div><b>{c.und}</b><small>{NAME[c.und] || c.und}</small></div>
              <span className={`chg ${c.chg >= 0 ? "g" : "r"}`}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%<small className="wk">7d</small></span>
            </div>
            <div className="reg">{REG[c.regime] || "No reading yet"}</div>
            <div className="dots"><Dot s={c.engine} label="Signal" /><Dot s={c.wallets} label="Wallets" /><Dot s={c.options} label="Options" /></div>
            {c.all ? <div className="badge">All three point up</div> : null}
          </div>
        ))}
      </div>
      <div className="key"><span><b className="g">●</b> Points up</span><span><b className="r">●</b> Points down</span><span><b className="z">●</b> Balanced</span><span>Dashed: not enough data yet</span></div>
    </Frame>
  );
}

const herdText = (m) =>
  `${m.up} of ${m.total} coins with options on ${TAG} are trending up. ` +
  (m.both.length ? `On ${join(m.both)}, the engine, smart wallets and options all point the same way. ` : "No coin has all three pointing up today. ") +
  "Here's the whole board.";

// 3. Higher or lower on the next Friday with a full ladder.
export function ladderModel(q) {
  if (!q?.dates?.length || !q.index) return null;
  const idx = q.index;
  for (const d of q.dates) {
    if (new Date(d.settle_ts * 1000).getUTCDay() !== 5) continue;
    const priced = d.levels.filter((l) => l.yes?.buy && l.no?.buy);
    const counts = {};
    for (const l of priced) counts[l.ladder] = (counts[l.ladder] || 0) + 1;
    const ladder = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const lv = priced.filter((l) => String(l.ladder) === ladder).sort((a, b) => Math.abs(a.k - idx) - Math.abs(b.k - idx)).slice(0, 5).sort((a, b) => b.k - a.k);
    if (lv.length < 4 || !lv.some((l) => l.k < idx) || !lv.some((l) => l.k >= idx)) continue;
    const mid = [...lv].sort((a, b) => Math.abs(a.k - idx) - Math.abs(b.k - idx))[0];
    return { und: q.und, idx, ts: q.prices_ts, settle: d.settle_ts, levels: lv, mid };
  }
  return null;
}

function LadderCard({ m }) {
  const day = weekday(m.settle);
  const rows = [];
  let placed = false;
  for (const l of m.levels) {
    if (!placed && l.k < m.idx) { rows.push(<div key="now" className="now"><span>{m.und} now {usd(m.idx)}</span></div>); placed = true; }
    rows.push(
      <div key={l.id} className="lvl glass">
        <div className="k"><b>{usd(l.k)}</b><small>pays in part ${Math.round(l.lo / 1000)}k–${Math.round(l.hi / 1000)}k</small></div>
        <div className="bar">
          <div className="hi" style={{ flex: l.yes.buy }}><span>Higher <b>{cents(l.yes.buy)}</b></span></div>
          <div className="lo" style={{ flex: l.no.buy }}><span><b>{cents(l.no.buy)}</b> Lower</span></div>
        </div>
      </div>
    );
  }
  return (
    <Frame kind="ladder" stamp={stampText("Derive prices", m.ts)} footRight="Prices per $1 before fees · Not investment advice">
      <div className="eyebrow">{NAME[m.und] || m.und} · {day} {dm(m.settle)}</div>
      <h1>{m.und} on {day}: <span className="g">higher</span> or <span className="r">lower</span>?</h1>
      <div className="sub">Pick a level and a side. Each answer pays up to <b>$1</b> at {day}'s 08:00 UTC settlement. The price is what it costs today.</div>
      <div className="ladder">{rows}</div>
      <div className="tiles">
        <div className="tile glass"><b className="m">{cents(m.mid.yes.buy)} → $1</b><span>Higher than {usd(m.mid.k)} pays in full from {usd(m.mid.hi)}</span></div>
        <div className="tile glass"><b>Only what you pay</b><span>is the most you can lose</span></div>
        <div className="tile glass"><b className="m">{day.slice(0, 3)} 08:00 UTC</b><span>Settles by itself, paid in USDC</span></div>
      </div>
    </Frame>
  );
}

const ladderText = (m) =>
  `${m.und} on ${weekday(m.settle)}: higher or lower? Higher than ${usd(m.mid.k)} costs ${cents(m.mid.yes.buy)} today and pays up to $1 at ${weekday(m.settle)}'s 08:00 UTC settlement. ` +
  `Only what you pay can be lost. Prices from ${TAG}.`;

export const CARDS = [
  { id: "range", title: "Options range, BTC", files: ["coins/BTC.json"], model: ([c]) => rangeModel(c, "BTC"), Card: RangeCard, text: rangeText },
  { id: "herd", title: "The herd", files: ["markets.json"], model: ([m]) => herdModel(m), Card: HerdCard, text: herdText },
  { id: "ladder", title: "Higher or lower, BTC Friday", files: ["questions/BTC.json"], model: ([q]) => ladderModel(q), Card: LadderCard, text: ladderText },
];
