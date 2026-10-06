// Market-wide cards: weekly movers, the mood, the regime mix over time, funding, one coin's regime.
import { SIGNAL_LABEL } from "../../lib/format.js";
import { REGIME_SHORT, lastRun } from "../../lib/regime.js";
import { Bars, Card, DOWN, GREY, LineChart, NAME, REG, REG_COLOR, TAG, UP, dm, fin, icon, join, pct, plural, price, stamp } from "../kit.jsx";

const optionCoins = (m) => (m?.coins || []).filter((c) => c.has_options);
const DAY = 86400;

// Weekly movers
export function moversModel(markets) {
  const coins = optionCoins(markets).filter((c) => fin(c.chg_7d)).sort((a, b) => b.chg_7d - a.chg_7d);
  if (coins.length < 6) return null;
  const btc = coins.find((c) => c.und === "BTC");
  return {
    ts: markets.generated_at, top: coins.slice(0, 3), bottom: coins.slice(-3), total: coins.length,
    up: coins.filter((c) => c.chg_7d > 0).length, btc, beatBtc: btc ? coins.filter((c) => c.chg_7d > btc.chg_7d).length : null,
  };
}

function MoversView({ m }) {
  const [t, b] = [m.top[0], m.bottom.at(-1)];
  const rows = [...m.top, ...m.bottom].map((c) => ({ label: c.und, sub: REG[c.regime_1d] || "No reading yet", icon: icon(c.und), value: c.chg_7d, text: pct(c.chg_7d) }));
  return (
    <Card glow="mixed" stampText={stamp("Derive index", m.ts)} eyebrow="Derive options markets · last 7 days"
      title={<><span className="g">{t.und} <span className="mono">{pct(t.chg_7d)}</span></span>, <span className="r">{b.und} <span className="mono">{pct(b.chg_7d)}</span></span></>}
      sub={<>Same market, opposite weeks. <b>{m.up} of {m.total}</b> coins with options closed the week higher{m.btc ? <>, and <b>{m.beatBtc}</b> beat Bitcoin's {pct(m.btc.chg_7d)}</> : null}.</>}
      tiles={[
        { big: `${m.up}/${m.total}`, text: "coins up on the week" },
        { big: pct(t.chg_7d - b.chg_7d, 0).replace("+", ""), text: `gap between ${t.und} and ${b.und}` },
        { big: REG[t.regime_1d] || "No reading", mono: false, tone: "g", text: `how our engine reads ${t.und} today` },
      ]}>
      <Bars rows={rows} signed />
    </Card>
  );
}

const moversAngles = (m) => {
  const [t, b] = [m.top[0], m.bottom.at(-1)];
  return [
    `${t.und} ${pct(t.chg_7d)} this week. ${b.und} ${pct(b.chg_7d)}. Same market, opposite weeks: ${m.up} of ${m.total} coins with options on ${TAG} closed higher. The full spread, best to worst:`,
    `Best week among coins with options on ${TAG}: ${t.und}, ${pct(t.chg_7d)}. Our engine reads it as ${(REG[t.regime_1d] || "no reading yet").toLowerCase()}: ${(REGIME_SHORT[t.regime_1d] || "too little history").toLowerCase()}. Worst: ${b.und} at ${pct(b.chg_7d)}.`,
    m.btc ? `Bitcoin ${pct(m.btc.chg_7d)} on the week. ${plural(m.beatBtc, "coin")} with options on ${TAG} did better, ${m.total - m.beatBtc - 1} did worse. When most coins trail BTC, money is hugging the big name.` : null,
  ].filter(Boolean);
};

// The mood: Fear & Greed with what sits behind it
export function moodModel(markets) {
  const c = markets?.context;
  const fg = c?.sentiment?.fear_greed_value;
  if (!fin(fg)) return null;
  const d = markets.consensus_detail?.["1d"]?.counts;
  return {
    ts: c.sentiment_at || markets.generated_at, fg, label: c.sentiment.fear_greed_label,
    stable: c.stablecoin, dom: c.global_metrics?.btc_dominance, up: d?.markup, total: d?.total,
  };
}

function Gauge({ v }) {
  const a = Math.PI * (1 - v / 100);
  const R = 190, cx = 220, cy = 220;
  const arc = (from, to) => {
    const p = (t) => [cx + R * Math.cos(Math.PI * (1 - t / 100)), cy - R * Math.sin(Math.PI * (1 - t / 100))];
    const [x0, y0] = p(from), [x1, y1] = p(to);
    return `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1}`;
  };
  const col = v >= 55 ? UP : v <= 45 ? DOWN : GREY;
  return (
    <svg width="440" height="250" viewBox="0 0 440 250">
      <path d={arc(0, 25)} stroke={DOWN} strokeOpacity=".75" strokeWidth="26" fill="none" />
      <path d={arc(25.8, 45)} stroke={DOWN} strokeOpacity=".35" strokeWidth="26" fill="none" />
      <path d={arc(45.8, 54.2)} stroke={GREY} strokeOpacity=".5" strokeWidth="26" fill="none" />
      <path d={arc(55, 74.2)} stroke={UP} strokeOpacity=".35" strokeWidth="26" fill="none" />
      <path d={arc(75, 100)} stroke={UP} strokeOpacity=".75" strokeWidth="26" fill="none" />
      <line x1={cx} y1={cy} x2={cx + (R - 40) * Math.cos(a)} y2={cy - (R - 40) * Math.sin(a)} stroke={col} strokeWidth="7" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="14" fill={col} />
      <text x="24" y="246" fill="#b9b0a4" fontFamily="Manrope" fontSize="16">Fear</text>
      <text x="416" y="246" fill="#b9b0a4" fontFamily="Manrope" fontSize="16" textAnchor="end">Greed</text>
    </svg>
  );
}

const moodWhy = (m) => m.fg >= 55
  ? "Buyers are bolder than usual: prices and momentum are up and people are talking about it."
  : m.fg <= 45 ? "People are nervous: prices are slipping and buyers are holding back." : "Neither side is in charge right now.";

function MoodView({ m }) {
  const col = m.fg >= 55 ? "g" : m.fg <= 45 ? "r" : "";
  const sc = m.stable?.change_7d_pct;
  return (
    <Card glow={m.fg >= 55 ? "up" : m.fg <= 45 ? "down" : "calm"} stampText={stamp("Market data", m.ts)} eyebrow="Crypto market mood · today"
      title={<>The market reads <span className={col}>{m.label}</span>: <span className="mono">{m.fg}</span> out of 100</>}
      sub={<>{moodWhy(m)} The index mixes price swings, momentum, social buzz and search into one number.</>}
      tiles={[
        m.up != null ? { big: `${m.up}/${m.total}`, text: "Derive perps our engine reads as trending up" } : null,
        fin(sc) ? { big: `${m.stable.total_cap ? "$" + Math.round(m.stable.total_cap / 1e9) + "B" : ""}`, text: `in stablecoins, ${pct(sc)} this week: cash waiting to be spent`, tone: sc >= 0 ? "g" : "r" } : null,
        fin(m.dom) ? { big: `${m.dom.toFixed(1)}%`, text: "of all crypto is Bitcoin" } : null,
      ].filter(Boolean)}>
      <div className="xgauge" style={{ justifyContent: "center" }}>
        <Gauge v={m.fg} />
        <div className={`xbig ${col}`}>{m.fg}<small>{m.label}</small></div>
      </div>
    </Card>
  );
}

const moodAngles = (m) => [
  `Crypto mood check: ${m.label}, ${m.fg} out of 100. ${moodWhy(m)} ${m.up != null ? `Our engine reads ${m.up} of ${m.total} perps on ${TAG} as trending up.` : `Prices from ${TAG}.`}`,
  fin(m.stable?.change_7d_pct) ? `${m.label} at ${m.fg}/100, while stablecoins moved ${pct(m.stable.change_7d_pct)} this week. Stablecoins are crypto's cash on the sidelines: when the pile grows, there's more ready to buy. Every coin on ${TAG}, read three ways:` : null,
  fin(m.dom) ? `Bitcoin is ${m.dom.toFixed(1)}% of all crypto, and the mood reads ${m.label} (${m.fg}). A high Bitcoin share with greed means money is confident but staying with the biggest coin. ${TAG}` : null,
].filter(Boolean);

// The regime mix over the last 120 days
export function breadthModel(markets) {
  const b = markets?.breadth_1d;
  const opt = new Set(optionCoins(markets).map((c) => c.und));
  if (!b?.rows?.length || !b.members?.length || !opt.size) return null;
  const days = b.rows.map((r, i) => {
    const counts = {};
    b.cols.forEach((col, j) => { counts[col] = (b.members[i]?.[j] || []).filter((u) => opt.has(u)).length; });
    return { ts: r[0], counts };
  });
  const now = days.at(-1), ago = days.at(-31) || days[0];
  const counted = Object.values(now.counts).reduce((t, n) => t + n, 0);
  const up = now.counts.MARKUP;
  const prevMax = Math.max(...days.slice(0, -1).map((d) => d.counts.MARKUP));
  let since = null;
  for (let i = days.length - 2; i >= 0; i--) if (days[i].counts.MARKUP >= up && days[i + 1].counts.MARKUP < up) { since = days[i]; break; }
  return { ts: markets.generated_at, days, cols: b.cols, total: counted || opt.size, up, ago: ago.counts.MARKUP, agoTs: ago.ts, record: up > prevMax, prevMax, since };
}

function BreadthView({ m }) {
  const W = 964, H = 360, n = m.days.length, bw = W / n;
  const order = ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"];
  const months = m.days.filter((d, i) => i === 0 || new Date(d.ts * 1000).getUTCDate() === 1);
  return (
    <Card glow="up" stampText={stamp("Cowboy engine", m.ts)} eyebrow={`Coins with options and a full price history · last ${n} days`}
      title={<><span className="g">{m.up} of {m.total}</span> coins are trending up{m.record ? ", the most in four months" : ""}</>}
      sub={<>Each column is one day; each block one coin, coloured by how our engine reads its trend. {m.ago !== m.up ? <>A month ago it was <b>{m.ago}</b>.</> : <>Same count as a month ago.</>}</>}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H + 30}`} preserveAspectRatio="xMidYMid meet">
        {m.days.map((d, i) => {
          let y = H;
          return order.map((r) => {
            const c = d.counts[r] || 0;
            if (!c) return null;
            const h = (c / m.total) * H;
            y -= h;
            return <rect key={r + i} x={i * bw + 0.6} y={y + 0.6} width={bw - 1.2} height={h - 1.2} rx="1.5" fill={REG_COLOR[r]} opacity={r === "MARKUP" ? 0.9 : 0.6} />;
          });
        })}
        {months.map((d) => <text key={d.ts} x={m.days.indexOf(d) * bw} y={H + 26} fill="#b9b0a4" fontFamily="Chivo Mono" fontSize="15">{dm(d.ts)}</text>)}
      </svg>
      <div className="xlegend">
        {["MARKUP", "REACC", "ACCUM", "BLOWOFF", "MARKDOWN"].map((r) => <span key={r}><i style={{ background: REG_COLOR[r] }} />{REG[r]}</span>)}
      </div>
    </Card>
  );
}

const breadthAngles = (m) => [
  `${m.up} of the ${m.total} coins with options on ${TAG} and a full price history are trending up${m.record ? ", the most in four months" : ""}. A month ago it was ${m.ago}. Here's every day since June, one block per coin, coloured by how our engine reads its trend.`,
  m.ago < m.up ? `A month ago ${m.ago} coins with options on ${TAG} were trending up. Today: ${m.up}. Uptrends spread one coin at a time, and you can watch it happen in this chart.` : `Trending up today: ${m.up} of ${m.total} coins with options on ${TAG}. A month ago: ${m.ago}. Trends fade one coin at a time before the headlines notice.`,
  `How we read a trend: each coin's price against its own 300-day path. Far above it and rising is "trending up"; slipping back is "cooling off". Today ${m.up} of ${m.total} coins on ${TAG} are trending up.`,
];

// Funding: what traders pay to stay long
export function fundingModel(markets) {
  const coins = (markets?.coins || []).filter((c) => fin(c.funding_ann)).sort((a, b) => b.funding_ann - a.funding_ann);
  if (coins.length < 5 || coins[0].funding_ann - coins.at(-1).funding_ann < 0.01) return null;
  const rows = [...coins.slice(0, 4), ...coins.slice(-3)].filter((c, i, a) => a.indexOf(c) === i);
  return { ts: markets.generated_at, rows, top: coins[0], low: coins.at(-1), paying: coins.filter((c) => c.funding_ann > 0).length, total: coins.length };
}

function FundingView({ m }) {
  return (
    <Card glow={m.top.funding_ann > 0.2 ? "up" : "mixed"} stampText={stamp("Derive perps", m.ts)} eyebrow="Derive perps · funding, per year"
      title={<>Longs pay <span className="mono g">{(m.top.funding_ann * 100).toFixed(0)}%</span> a year to hold {m.top.und}</>}
      sub={<>A perp has no expiry, so traders pay each other to keep positions open. When longs pay shorts, the long side is the crowded one: <b>{m.paying} of {m.total}</b> coins have longs paying today.</>}
      tiles={[
        { big: `${(m.top.funding_ann * 100).toFixed(1)}%`, text: `${m.top.und}: the most crowded long`, tone: "g" },
        { big: `${(m.low.funding_ann * 100).toFixed(1)}%`, text: m.low.funding_ann < 0 ? `${m.low.und}: shorts pay to stay short` : `${m.low.und}: the cheapest to hold long`, tone: m.low.funding_ann < 0 ? "r" : "" },
        { big: `${m.paying}/${m.total}`, text: "coins where longs pay" },
      ]}>
      <Bars rows={m.rows.map((c) => ({ label: c.und, sub: NAME[c.und], icon: icon(c.und), value: c.funding_ann, text: `${(c.funding_ann * 100).toFixed(1)}%` }))} signed />
    </Card>
  );
}

const fundingAngles = (m) => [
  `Holding a ${m.top.und} long on ${TAG} costs ${(m.top.funding_ann * 100).toFixed(1)}% a year in funding right now. That's the price of being on the crowded side. ${m.low.funding_ann < 0 ? `On ${m.low.und} it's the reverse: shorts pay longs.` : `Cheapest long: ${m.low.und}.`}`,
  `Funding in one line: when everyone wants the same side, they pay for it. Today longs pay on ${m.paying} of ${m.total} perps on ${TAG}, ${m.top.und} the most at ${(m.top.funding_ann * 100).toFixed(1)}% a year.`,
];

// One coin's regime, how long, and where it sits against its long-term average
export function spotlightModel(coin, markets, und) {
  const rows = coin?.history?.engine?.["1d"] || [];
  const candles = coin?.candles?.["1d"] || [];
  if (rows.length < 30 || candles.length < 30) return null;
  const [cur, n, start] = lastRun(rows.map((r) => r.regime ?? null));
  if (!cur || start < 0) return null;
  // A trend word that contradicts the long-term average reads as an error to a newcomer: leave that coin out.
  if (coin.band && ((["MARKUP", "BLOWOFF"].includes(cur) && coin.band.side === "below") || (["MARKDOWN", "CAP"].includes(cur) && coin.band.side === "above"))) return null;
  const first = rows.findIndex((r) => r.regime != null);
  const closeAt = new Map(candles.map((c) => [c[0] + DAY, c[4]]));
  const pts = rows.map((r) => [r.ts, closeAt.get(r.ts), r.regime]).filter((p) => fin(p[1]));
  const startTs = rows[start].ts - DAY;
  const startPx = closeAt.get(rows[start].ts - DAY) ?? pts.find((p) => p[0] >= rows[start].ts)?.[1];
  const last = pts.at(-1);
  const mk = optionCoins(markets).find((c) => c.und === und) || (markets?.coins || []).find((c) => c.und === und);
  return {
    und, ts: coin.generated_at, regime: cur, n, open: start === first, startTs, startPx, px: last[1], pts,
    band: coin.band, signal: rows.at(-1).signal, chg7: mk?.chg_7d,
  };
}

function SpotlightView({ m }) {
  const segs = [];
  for (let i = 1; i < m.pts.length; i++) {
    const r = m.pts[i][2];
    if (!segs.length || segs.at(-1).r !== r) segs.push({ r, pts: [m.pts[i - 1]] });
    segs.at(-1).pts.push(m.pts[i]);
  }
  const since = m.startPx ? (m.px / m.startPx - 1) * 100 : null;
  const tone = ["MARKUP", "ACCUM"].includes(m.regime) ? "up" : ["MARKDOWN", "CAP"].includes(m.regime) ? "down" : "mixed";
  const xs = m.pts.map((p) => p[0]);
  return (
    <Card glow={tone} stampText={stamp("Cowboy engine", m.ts)} eyebrow={`${NAME[m.und] || m.und} · daily trend`}
      title={<>{m.und} has been <span style={{ color: REG_COLOR[m.regime] }}>{(REG[m.regime] || "").toLowerCase()}</span> for {m.open ? `${m.n}+` : m.n} days</>}
      sub={<>{REGIME_SHORT[m.regime] || ""}. {m.band ? <>It has been {m.band.side} its long-term average since <b>{dm(m.band.since)}</b>{m.band.side === "above" ? ", the line our engine checks before any up-setup" : "; our engine calls no up-setup until it is back above"}.</> : null}</>}
      tiles={[
        since != null ? { big: pct(since), text: `since the trend started on ${dm(m.startTs)}`, tone: since >= 0 ? "g" : "r" } : null,
        m.band ? { big: `${m.band.days}d`, text: `${m.band.side} its long-term average` } : null,
        { big: SIGNAL_LABEL[m.signal] || "No clear setup", mono: false, text: "what our engine says today" },
      ].filter(Boolean)}>
      <LineChart id={`sp-${m.und}`} h={360} series={segs.map((s) => ({ pts: s.pts.map((p) => [p[0], p[1]]), color: REG_COLOR[s.r] || GREY, width: 3.4 }))}
        yFmt={price} xLabels={[[xs[0], dm(xs[0])], [xs.at(-1), "Today"]]} marks={[{ x: xs.at(-1), y: m.px, label: price(m.px), color: "#ffffff" }]} />
      <div className="xlegend">{[...new Set(segs.map((s) => s.r))].map((r) => <span key={r}><i style={{ background: REG_COLOR[r] }} />{REG[r]}</span>)}</div>
    </Card>
  );
}

const spotlightAngles = (m) => {
  const since = m.startPx ? (m.px / m.startPx - 1) * 100 : null;
  return [
    `${m.und} has been ${(REG[m.regime] || "").toLowerCase()} for ${m.n}${m.open ? "+" : ""} days${since != null ? `, ${pct(since)} since it started on ${dm(m.startTs)}` : ""}. ${REGIME_SHORT[m.regime] || ""}. Options on ${TAG}:`,
    m.band ? `${m.und} has been ${m.band.side} its long-term average since ${dm(m.band.since)}, ${m.band.days} days. ${m.band.side === "above" ? "Our engine checks this line before it calls any up-setup." : "Our engine calls no up-setup until it's back above."} ${TAG}` : null,
    `Our engine on ${m.und}: ${(REG[m.regime] || "").toLowerCase()} for ${m.n}${m.open ? "+" : ""} days, setup "${SIGNAL_LABEL[m.signal] || "no clear setup"}". The colours on the line show every change of mood over the last four months. ${TAG}`,
  ].filter(Boolean);
};

export const MARKET = [
  { id: "movers", group: "Market", title: "Weekly movers", files: () => ["markets.json"], model: ([m]) => moversModel(m), View: MoversView, angles: moversAngles },
  { id: "mood", group: "Market", title: "Market mood", files: () => ["markets.json"], model: ([m]) => moodModel(m), View: MoodView, angles: moodAngles },
  { id: "breadth", group: "Market", title: "Trend mix, 120 days", files: () => ["markets.json"], model: ([m]) => breadthModel(m), View: BreadthView, angles: breadthAngles },
  { id: "funding", group: "Market", title: "Funding: who pays", files: () => ["markets.json"], model: ([m]) => fundingModel(m), View: FundingView, angles: fundingAngles },
  { id: "spotlight", group: "Coins", title: "Coin trend spotlight", params: ["BTC", "ETH", "SOL", "HYPE", "XRP", "ZEC", "ADA", "XAUT"], files: (u) => [`coins/${u}.json`, "markets.json"], model: ([c, m], u) => spotlightModel(c, m, u), View: SpotlightView, angles: spotlightAngles },
];

export { join };
