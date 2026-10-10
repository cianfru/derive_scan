// The home cards drawn from Cowboy's own data (owner, 10 October 2026: the drawn icons looked cheap and the
// generated renders "too AI generated"; "the numbers are too small ... we have a lot of room ... just use
// it"). One widget language for every card: a figure row (one big figure, the one the card's page leads
// with, and a short caption that wraps under it rather than being cut) over a chart band that takes the
// rest of the card, drawn in real pixels (lib/homeLayout.js). Colour only on signed money; calls and puts
// in their own colours, regimes in theirs; orange stays interaction. While its file loads a card keeps a
// still placeholder of its size; without its file it shows its own title and "Not available yet".
import { Fragment, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { REGIME, ago, strike, usd } from "../lib/format.js";
import { REGIME_COLORS, REGIME_ORDER } from "../lib/regime.js";
import { radarPoint, viewReading } from "../lib/presentation.js";
import { regimeGroups } from "../lib/takeaway.js";
import { posseName } from "../lib/posses.js";
import { codename } from "../lib/walletName.js";
import { loadPositions } from "../lib/positions.js";
import { positionDone } from "../lib/positionView.js";
import { openPnl, pctText } from "../lib/homePnl.js";
import { compactCount, groupIconSize, radarLayout } from "../lib/homeLayout.js";
import { largestTrade } from "../lib/flowStories.js";
import { flowCoins, leanWords } from "../lib/flowBubbles.js";
import { useFollowsDoc } from "../lib/follows.js";
import { boardRows } from "../lib/board.js";
import { useClock } from "../lib/useClock.js";
import { money, priceAge, signed } from "../lib/questions.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { useElementSize, useElementWidth } from "../lib/useElementWidth.js";
import { useFeeds } from "./Feeds.jsx";
import { regimeCounts, stripColumns } from "./StructureBand.jsx";
import { CoinIcon } from "./MarketVisuals.jsx";
import { chartLevels, returnPct, smartOf } from "./SaloonChart.jsx";
import { WalletEmblem } from "./WalletTag.jsx";
import { Info } from "./ui.jsx";
import BigNum from "./BigNum.jsx";
import FlowBubbles from "./FlowBubbles.jsx";

const NET = TESTNET_FILLS ? "testnet" : "mainnet";
const N = ({ children, className = "" }) => <b className={`n${className ? ` ${className}` : ""}`}>{children}</b>;
const signedUsd = (v) => `${v >= 0 ? "+" : ""}${usd(v)}`;
const UPDATING = "These figures are updating. They return with the next publish, usually within 15 minutes.";

/** A card while its file loads: a still placeholder of the widget's size (nothing pulses). */
export function Wait() {
  return <div className="hl hl-wait" aria-hidden="true"><i className="hl-ph-fig" /><i className="hl-band hl-ph-band" /></div>;
}

/** A card without its file: its own title, and "Not available yet" with the reason in an (i). */
export function NotYet({ card, why = UPDATING }) {
  return (
    <div className="hl hl-none">
      {card?.title && <b className="hl-title" aria-hidden="true">{card.title}</b>}
      <span className="hl-cue">Not available yet <Info label="Why this is not available">{why}</Info></span>
    </div>
  );
}

/**
 * This browser's open positions as the card shows them, the followed answers, and where the card leads:
 * Positions while something is open, else Following when the user follows answers, else the Saloon.
 * Boards load only for the coins held.
 */
export function useHomePositions() {
  const [list] = useState(() => { try { return loadPositions(NET); } catch { return []; } });
  const follows = useFollowsDoc().follows.length;
  const now = Date.now() / 1000;
  const unds = [...new Set(list.filter((p) => !positionDone(p, now)).map((p) => p.und).filter(Boolean))];
  const [feeds, files, ready] = useFeeds(unds.map((u) => `questions/${u}.json`));
  const r = openPnl(list, Object.fromEntries(unds.map((u) => [u, files[`questions/${u}.json`]])), now);
  const to = r.open ? "/saloon/mine" : follows ? "/saloon/mine?tab=following" : "/saloon";
  const cta = r.open ? "Open your positions" : follows ? "Open Following" : "Enter the Saloon";
  // Only the loaders: a mixed-publication notice belongs on Positions, not on the home page.
  return { feeds: feeds.filter((e) => e.key !== "publication-notice"), ready: ready || !unds.length, r, follows, to, cta };
}

/* The Saloon in miniature (owner, 10 October 2026: the picture "is the only one that is stale ... make it
 * consistent with the rest of the cards"): the same chart the Saloon opens on, drawn from its own files. One
 * coin's last three days of 4-hour closes, the price now as the dashed line, and its nearest settlement dates
 * as columns with the two levels either side of the price as bubbles: Higher above (green), Lower below (red),
 * the figure inside the most it makes on $100, fees included, as on the Saloon; a gold ring where the Smart
 * wallets lean that way (context, not a signal). */
const SALOON_REF = 100, SALOON_BARS = 18;
const smooth = (pts) => pts.reduce((d, [x, y], i) => {
  if (!i) return `M${x},${y}`;
  const [x0, y0] = pts[i - 1], mx = (x0 + x) / 2;
  return `${d} C${mx},${y0} ${mx},${y} ${x},${y}`;
}, "");

export function SaloonLive({ pop = false }) {
  const id = useId().replace(/:/g, "");
  const now = useClock();
  const { data: index } = useData("questions/index.json");
  const listed = (index?.coins || []).map((c) => c.und);
  const und = listed.includes("BTC") ? "BTC" : listed[0] || null;
  const { data: board } = useData(und ? `questions/${und}.json` : null);
  const { data: coin } = useData(und ? `coins/${und}.json` : null);
  const [band, size] = useElementSize({ w: 420, h: 300 });
  if (!index || (und && (!board || !coin))) return <Wait />;
  const closes = (coin?.candles?.["4h"] || []).slice(-SALOON_BARS).map((c) => c[4]).filter(Number.isFinite);
  if (!und || !board?.index || closes.length < 2) return null;
  const rows = boardRows([board], SALOON_REF, { now }).rows;
  const by = new Map();
  for (const r of rows) { if (!by.has(r.expiry)) by.set(r.expiry, []); by.get(r.expiry).push(r); }
  const dates = chartLevels([...by.keys()].sort().map((e) => ({ expiry: e, settle: by.get(e)[0].settleTs, rows: by.get(e) })), board.index)
    .slice(0, pop ? 4 : 3).map((d) => {
      const near = (up) => d.levels.filter((l) => (up ? l.k >= board.index : l.k < board.index))
        .sort((a, b) => Math.abs(a.k - board.index) - Math.abs(b.k - board.index)).slice(0, 2);
      return { ...d, show: [...near(true), ...near(false)] };
    });
  const W = size?.w || 420, H = size?.h || 300;
  // The price axis is set by the bubbles shown (so they spread out as on the Saloon); the price line runs
  // off the band where the last days went further, clipped and faded at the left edge.
  const ks = dates.flatMap((d) => d.show.map((l) => l.k));
  const far = Math.max(board.index * 0.012, ...ks.map((k) => Math.abs(k - board.index)));
  let lo = board.index - far * 1.35, hi = board.index + far * 1.35;
  const top = 6, bottom = H - 24;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  let lineW = W * (dates.length ? 0.42 : 0.92), yNow = y(board.index);
  const colX = (i) => lineW + ((i + 0.6) / (dates.length + 0.2)) * (W - lineW - 8);
  const rMax = Math.max(22, Math.min(36, (W - lineW) / (dates.length || 1) / 2.4)), rMin = 22;
  const maxPct = Math.max(1, ...dates.flatMap((d) => d.show.map((l) => l.r.make / l.r.total)));
  const label = (l) => returnPct(l.r.make, l.r.total);
  // Bigger return, bigger bubble; a bubble never crosses the price line or its neighbour, and a level
  // without room for a readable figure is left out (the Saloon itself shows every level).
  for (const d of dates) {
    const placed = [];
    for (const up of [true, false]) {
      let edge = yNow;
      for (const l of d.show.filter((x) => (x.k >= board.index) === up)) {
        const want = rMin + (rMax - rMin) * Math.sqrt(l.r.make / l.r.total / maxPct), yy = y(l.k);
        const room = Math.abs(yy - edge) - 3;
        const r = Math.min(want, room, up ? yy - 2 : H - 22 - yy);
        if (r < rMin) continue;
        placed.push({ ...l, r: l.r, rad: r, yy });
        edge = up ? yy - r : yy + r;
      }
    }
    d.placed = placed;
  }
  // No bubble to show: the line alone, on the axis of its own closes. While prices are paused the card's
  // foot says so; otherwise Derive quotes none of these levels now.
  const none = !dates.some((d) => d.placed.length);
  const paused = priceAge(board.prices_ts, now, board.paused).state === "paused";
  if (none) {
    const span = Math.max(...closes, board.index) - Math.min(...closes, board.index) || board.index * 0.01;
    lo = Math.min(...closes, board.index) - span * 0.15; hi = Math.max(...closes, board.index) + span * 0.15;
    lineW = W * 0.92; yNow = y(board.index);
  }
  const pts = closes.map((c, i) => [10 + (i / (closes.length - 1)) * (lineW - 10), y(c)]);
  return (
    <div className={`hl hl-saloon${pop ? " in-pop" : ""}`}>
      <div className="hl-band" ref={band}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`${und} over the last three days, now ${money(board.index)}; ${dates.map((d) => `${shortDay(d.expiry)}: ${d.placed.map((l) => `${l.r.side === "yes" ? "Higher" : "Lower"} than ${money(l.k)} up to ${label(l)}`).join(", ")}`).join("; ")}`}>
          <defs>
            {["up", "down"].map((k) => (
              <radialGradient key={k} id={`${id}-${k}`} cx="34%" cy="30%" r="75%">
                <stop offset="0%" className={`sb-${k}-hi`} /><stop offset="55%" className={`sb-${k}-mid`} /><stop offset="100%" className={`sb-${k}-lo`} />
              </radialGradient>
            ))}
            <clipPath id={`${id}-clip`}><rect x="0" y="0" width={W} height={bottom + 4} /></clipPath>
            <linearGradient id={`${id}-fade`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".22" stopColor="#fff" stopOpacity="1" /></linearGradient>
            <mask id={`${id}-mask`}><rect x="0" y="0" width={W} height={H} fill={`url(#${id}-fade)`} /></mask>
            <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" /></filter>
          </defs>
          <g clipPath={`url(#${id}-clip)`} mask={`url(#${id}-mask)`}><path d={smooth(pts)} className="sb-price" /></g>
          <line x1="0" x2={W} y1={yNow} y2={yNow} className="sb-now" />
          {!none && dates.map((d, i) => <text key={d.expiry} x={colX(i)} y={H - 6} className="sb-date" textAnchor="middle">{shortDay(d.expiry)}</text>)}
          {dates.map((d, i) => d.placed.map((l) => {
            const x = colX(i), yy = l.yy, r = l.rad, up = l.r.side === "yes";
            const edge = up ? yy + r : yy - r, k = up ? "up" : "down", ring = !!smartOf(l.r);
            return (
              <g key={`${d.expiry}${l.k}`}>
                <line x1={x} x2={x} y1={yNow} y2={edge} className={`sb-stem ${k}`} />
                <circle cx={x} cy={yNow} r="2.5" className={`sb-foot ${k}`} />
                <circle cx={x - r * 0.25} cy={yy - r * 0.2} r={r * 0.95} className={`sb-halo ${k}`} filter={`url(#${id}-glow)`} />
                <circle cx={x} cy={yy} r={r} fill={`url(#${id}-${k})`} className={`sb-ball ${k}`} />
                <ellipse cx={x - r * 0.32} cy={yy - r * 0.42} rx={r * 0.32} ry={r * 0.2} className="sb-shine" />
                {ring && <circle cx={x} cy={yy} r={r + 3} className="sb-gold" />}
                <text x={x} y={yy + 4} className={`sb-fig ${k}`} textAnchor="middle" style={{ fontSize: Math.min(15, Math.max(12, r * 0.42)) }}>{label(l)}</text>
              </g>
            );
          }))}
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="5" className="sb-dot" />
          {none && !paused && <text x={W - 8} y={20} textAnchor="end" className="sb-none">No prices on Derive right now</text>}
        </svg>
      </div>
    </div>
  );
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (e) => (e ? `${+e.slice(6, 8)} ${SHORT_MONTHS[+e.slice(4, 6) - 1]}` : "");
const shortLevel = (k) => (k >= 10000 ? `${(k / 1000).toFixed(k % 1000 ? 1 : 0)}k` : strike(k, ""));
const ROWS_ON_CARD = 3;

/**
 * Your positions (owner, 10 October 2026: "I want to see the position that I have right now and the P&L of
 * those open positions ... green or red"): the P&L of everything open as one percentage of what was paid,
 * then each open position with its own, largest first; "No price now" on a position without a sell-back
 * price. The owner's own words when nothing is open (with the answers followed, when there are some).
 */
export function PositionsLive({ pos, pop = false }) {
  if (!pos?.ready) return <Wait />;
  const { r, follows } = pos;
  if (!r.open) return (
    <div className="hl hl-pos">
      <b className="hl-word">No open positions</b>
      <span className="hl-cue">{follows
        ? <><N>{follows}</N> {follows === 1 ? "answer" : "answers"} you follow</>
        // On the card the whole card leads to the Saloon; in the pop-out the button below does.
        : <span className={pop ? undefined : "hl-go"}>Pick a side in the Saloon</span>}</span>
    </div>
  );
  const side = r.pct == null ? "" : r.pct >= 0 ? "up" : "down";
  const shown = pop ? r.rows : r.rows.slice(0, ROWS_ON_CARD);
  const more = r.rows.length - shown.length;
  return (
    <div className={`hl hl-pos${side ? ` ${side}` : ""}`}>
      <div className="hl-fig">
        {r.pct == null
          ? <b className="hl-word">Not valued yet</b>
          : <BigNum className={side} text={pctText(r.pct)} />}
        <span className="hl-cap">
          <span>{r.pct == null ? "No price now" : "P&L now"}{r.pct == null && <Info label="Why there is no value now">Prices are paused or these
            answers are no longer on the board, so Derive's sell-back price is not shown.</Info>}</span>
          <span><N>{r.open}</N> open{r.priced && r.priced < r.open ? <>, <N>{r.priced}</N> valued</> : null}</span>
        </span>
      </div>
      <ul className="hl-plist">
        {shown.map((x) => (
          <li key={x.key}>
            <CoinIcon und={x.und} />
            <span className="hl-pname">{x.side === "yes" ? "Higher" : "Lower"} <N>{shortLevel(x.k)}</N><i>{shortDay(x.expiry)}</i></span>
            {x.pct == null ? <span className="hl-pnone">No price now</span>
              : <N className={x.pct >= 0 ? "up" : "down"}>{pctText(x.pct)}</N>}
          </li>
        ))}
        {more > 0 && <li className="hl-pmore"><N>+{more}</N> more</li>}
      </ul>
    </div>
  );
}

const WALLETS = { up: "Smart wallets long", defensive: "Smart wallets short", neutral: "Smart wallets balanced" };
/**
 * Radar: the Radar page in miniature. Every coin with options placed across by how far its price has
 * stretched from its trend (the 1D engine) and up by how the Smart wallets hold it on options expiring
 * within 30 days (the page's default window), on a field tinted long above and short below. Coins without
 * a wallet reading sit faint on a dashed lane under the field, never inside it; with no wallet reading at
 * all the field becomes one stretch line. The most stretched coin is named and ringed.
 */
export function RadarLive({ card }) {
  const { data, loading } = useData("markets.json");
  const [band, box] = useElementSize({ w: 320, h: 110 });
  if (loading) return <Wait />;
  const now = Date.now() / 1000;
  const coins = (data?.coins || []).filter((c) => c.has_options);
  const points = coins.map((c) => radarPoint(c, "30d", now)).filter(Boolean)
    .map((p) => ({ und: p.coin.und, x: p.x, y: p.y, w: viewReading(p.coin.align, "30d", "wallets", now).state }));
  const placed = new Set(points.map((p) => p.und));
  const strip = coins.filter((c) => !placed.has(c.und) && Number.isFinite(c.z_1d) && viewReading(c.align, "30d", "engine", now).state)
    .map((c) => ({ und: c.und, x: c.z_1d, y: null }));
  const all = [...points, ...strip];
  if (!all.length) return <NotYet card={card} />;
  const hero = all.reduce((a, b) => (Math.abs(b.x) > Math.abs(a.x) ? b : a));
  const calm = Math.abs(hero.x) < 0.25;
  hero.lead = !calm;
  const side = (x) => (x >= 0 ? "above trend" : "below trend");
  const title = (p) => `${p.und} · ${side(p.x)} · ${p.y == null ? "no wallet reading" : `${WALLETS[p.w] || "Smart wallets balanced"}, 30 days`}`;
  const L = box && radarLayout(points, strip, box);
  const order = (list) => [...list.filter((p) => !p.lead), ...list.filter((p) => p.lead)];
  const mark = (p, i, off) => (
    <span key={p.und} className={`hl-pt${off ? " off" : ""}${p.lead ? " hl-lead" : ""}`} title={title(p)}
      style={{ "--d": i, left: `${p.px.toFixed(1)}px`, top: `${p.py.toFixed(1)}px`, width: p.s, height: p.s }}>
      <CoinIcon und={p.und} />
    </span>
  );
  return (
    <div className="hl hl-radar">
      <div className="hl-fig">
        {calm ? <b className="hl-word">All near their trend</b>
          : <span className="hl-coin"><CoinIcon und={hero.und} /><b className="hl-tick">{hero.und}</b></span>}
        {(!calm || !points.length) && <span className="hl-cap">
          {!calm && <span>Most stretched, {side(hero.x)}</span>}
          {!points.length && <span className="hl-sub">Wallet readings updating</span>}
        </span>}
      </div>
      <div className="hl-band hl-map" ref={band} aria-hidden="true">
        {L && <>
          <div className={`hl-plot${L.flat ? " flat" : ""}`} style={{ height: L.ph }}>
            {!L.flat && <><i className="hl-half long" /><i className="hl-half short" /><i className="hl-zero" style={{ left: L.zero }} />
              {L.words && <><span className="hl-yw long" style={{ left: L.wordsAt }}>{L.words[0]}</span>
                <span className="hl-yw short" style={{ left: L.wordsAt }}>{L.words[1]}</span></>}</>}
            <i className="hl-mid" />
            {order(L.marks).map((p, i) => mark(p, i, false))}
          </div>
          {L.lane > 0 && <div className="hl-lane" style={{ top: L.laneY }}>{order(L.laneMarks).map((p, i) => mark({ ...p, py: 0 }, i + L.marks.length, true))}</div>}
          {L.axis > 0 && <div className="hl-xw"><span>Below trend</span>
            {L.offMap > 0 && <span className="hl-xw-mid"><N>{L.offMap}</N> without a wallet reading</span>}<span>Above trend</span></div>}
        </>}
      </div>
    </div>
  );
}

/** A link to the trader's page in the pop-out, plain text on the card (the card itself opens the leaderboard). */
function TraderLink({ address, pop, className, children }) {
  return pop ? <Link to={`/trader/${address}`} className={className}>{children}</Link> : <span className={className}>{children}</span>;
}
/** Smart traders: the best-ranked Smart wallets only (income sellers and hedgers are not traders to
 * follow), the first one's gross options P&L large, the next ones as rows that share the band (two on
 * the card, five in the pop-out). A long codename ends in an ellipsis with the full name on hover. */
export function TradersLive({ pop = false, card }) {
  const { data, loading } = useData("traders.json");
  const [rows, box] = useElementSize({ w: 300, h: 200 });
  if (loading) return <Wait />;
  const smart = (data?.traders || []).filter((t) => (t.tier === "top" || t.tier === "smart")
    && Number.isFinite(t.option_pnl) && Number.isFinite(t.rank)).slice(0, pop ? 6 : 3);
  if (!smart.length) return <NotYet card={card} />;
  const [lead, ...rest] = smart;
  const tone = (v) => (v >= 0 ? "up" : "down");
  // As many rows as the band holds at 22px or more each (always one); under 34px each they go compact.
  const fit = box ? Math.max(1, Math.min(rest.length, Math.floor(box.h / 22))) : rest.length;
  const compact = !!box && box.h / fit < 34;
  return (
    <div className="hl hl-traders">
      <div className="hl-fig">
        <BigNum className={tone(lead.option_pnl)} text={signedUsd(lead.option_pnl)} />
        <span className="hl-cap">
          <TraderLink address={lead.address} pop={pop} className="hl-who">
            <WalletEmblem address={lead.address} size={22} /><N className="hl-rank">#{lead.rank}</N>
            <span className="hl-name" title={codename(lead.address)}>{codename(lead.address)}</span>
          </TraderLink>
          <span className="hl-sub">gross options P&amp;L</span>
        </span>
      </div>
      {rest.length > 0 && <ol className={`hl-band hl-rows${compact ? " compact" : ""}`} ref={rows} aria-label="Next Smart wallets, gross options P&L">
        {rest.slice(0, fit).map((t) => (
          <li key={t.address}><TraderLink address={t.address} pop={pop} className="hl-row">
            <WalletEmblem address={t.address} size={26} /><N className="hl-rank">#{t.rank}</N>
            <span className="hl-name" title={codename(t.address)}>{codename(t.address)}</span><N className={tone(t.option_pnl)}>{signedUsd(t.option_pnl)}</N>
          </TraderLink></li>
        ))}
      </ol>}
    </div>
  );
}

/** Markets: the count the Markets page leads with (options markets in the largest daily regime), then the
 * coins themselves grouped by regime, largest open interest first, each group named under its rule; at
 * most three groups, the rest as Other. The pop-out adds every perp's regime mix over 90 daily closes. */
export function MarketsLive({ pop = false, card }) {
  const { data, loading } = useData("markets.json");
  const [area, box] = useElementSize({ w: 320, h: 80 });
  if (loading) return <Wait />;
  const now = Date.now() / 1000;
  const { all, read, n, groups } = regimeGroups(data, now);
  if (!groups.length) return <NotYet card={card} />;
  const top = groups[0];
  const coinsOf = (keys) => read.filter((c) => keys.includes(c.regime_1d)).sort((a, b) => (b.oi_usd || 0) - (a.oi_usd || 0));
  const shown = groups.slice(0, groups.length > 3 ? 2 : 3).map((k) => ({ k, name: REGIME[k], color: REGIME_COLORS[k], n: n[k], coins: coinsOf([k]) }));
  if (groups.length > 3) {
    const rest = groups.slice(2);
    shown.push({ k: "OTHER", name: "Other", color: "var(--neutral)", n: rest.reduce((s, k) => s + n[k], 0), coins: coinsOf(rest) });
  }
  // The group names need about 50px of band; under that the coloured rules alone (the caption names the largest).
  const named = !box || box.h >= 50;
  const s = box && groupIconSize(shown.map((g) => ({ n: g.coins.length, name: `${g.name} ${g.n}` })), box, named);
  return (
    <div className="hl hl-markets">
      <div className="hl-fig">
        <span className="hl-hero"><BigNum text={String(n[top])} /><span className="hl-of">of <N>{read.length}</N></span></span>
        <span className="hl-cap">
          <span className="hl-cap-main">{REGIME[top].toLowerCase()}</span>
          <span>{read.length < all.length ? <><N>{read.length}</N> of <N>{all.length}</N> read on the daily close</>
            : <><span className="hl-roomy">options markets · </span>daily close</>}</span>
        </span>
      </div>
      <div className="hl-band hl-groups" aria-hidden="true">
        <div className="hl-groups-in" ref={area}>
          {s > 0 && <div className="hl-icons" style={{ "--ic": `${s}px` }}>
            {shown.map((g, gi) => (
              <span key={g.k} className="hl-grp" style={{ "--rc": g.color }}>
                <span className="hl-grp-ics">{g.coins.map((c, i) => (
                  <span key={c.und} className="hl-ic" style={{ "--d": gi * 4 + i }} title={`${c.und} · ${REGIME[c.regime_1d]}`}><CoinIcon und={c.und} /></span>
                ))}</span>
                {named && <span className="hl-grp-name">{g.name} <N>{g.n}</N></span>}
              </span>
            ))}
          </div>}
        </div>
        {pop && <RegimeMix data={data} now={now} />}
      </div>
    </div>
  );
}

/** Every perp's daily regime mix over the last 90 closes as stacked areas, drawn at the stage's real width,
 * with a key of every regime it shows. */
function RegimeMix({ data, now }) {
  const [box, W] = useElementWidth(400);
  const cols = stripColumns(data.breadth_1d, regimeCounts(data.coins || [], now), data.bars?.["1d"]).slice(-90);
  if (cols.length < 2) return null;
  const H = 44, x = (i) => (i / (cols.length - 1)) * W;
  const shares = cols.map((c) => {
    const total = REGIME_ORDER.reduce((s, k) => s + (c.n[k] || 0), 0) || 1;
    let y = 0;
    return Object.fromEntries(REGIME_ORDER.map((k) => { const lo = y; y += (c.n[k] || 0) / total; return [k, [lo, y]]; }));
  });
  const present = REGIME_ORDER.filter((k) => shares.some((s) => s[k][1] > s[k][0]));
  const yOf = (v) => (H - v * H).toFixed(1);
  return (
    <figure className="hl-mix" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} focusable="false">
        {present.map((k) => {
          const top = shares.map((s, i) => `${x(i).toFixed(1)},${yOf(s[k][1])}`);
          const bottom = shares.map((s, i) => `${x(i).toFixed(1)},${yOf(s[k][0])}`).reverse();
          return <path key={k} d={`M${top.join("L")}L${bottom.join("L")}Z`} style={{ fill: REGIME_COLORS[k] }}><title>{REGIME[k]}</title></path>;
        })}
      </svg>
      <figcaption>All perps, last 90 daily closes</figcaption>
      <div className="hl-mix-key">{present.map((k) => <span key={k}><i style={{ background: REGIME_COLORS[k] }} />{REGIME[k]}</span>)}</div>
    </figure>
  );
}

/** Posses: every options trader by results on expired options, Legend on the left to Boot Hill on the
 * right (the published order), as one ladder of counts on a square-root scale (every step visible, the
 * counts printed under it), a rule between profit and loss, and the share of traders in profit. */
export function PossesLive({ card }) {
  const { data, loading } = useData("traders.json");
  if (loading) return <Wait />;
  const g = (data?.cohorts?.pnl || []).slice(0, 8);
  const total = g.reduce((s, c) => s + (c.wallets || 0), 0);
  if (g.length < 8 || !total) return <NotYet card={card} />;
  const profit = g.slice(0, 4).reduce((s, c) => s + (c.wallets || 0), 0);
  const max = Math.max(...g.map((c) => c.wallets || 0));
  return (
    <div className="hl hl-posses">
      <div className="hl-fig">
        <BigNum text={`${Math.round((profit / total) * 100)}%`} />
        <span className="hl-cap">of options traders in profit on expired options</span>
      </div>
      <div className="hl-band hl-ladder" aria-hidden="true">
        <i className="hl-pl-rule" />
        {g.map((c, i) => (
          <div key={c.name} className={`hl-step ${i < 4 ? "up" : "down"}`} title={`${posseName(c.name)}: ${(c.wallets || 0).toLocaleString("en-US")} traders`}>
            <span className="hl-bar"><i style={{ "--h": Math.sqrt((c.wallets || 0) / max).toFixed(4), "--d": i }} /></span>
            <N>{compactCount(c.wallets || 0)}</N>
          </div>
        ))}
        <div className="hl-ends"><span>{posseName(g[0].name)}</span><span>{posseName(g[7].name)}</span></div>
      </div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "7 Oct 08:30" in UTC. */
const when = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`; };
/** Past this age the flow file no longer reads as "the last 24 hours" and names its window instead. */
export const FLOW_FRESH_SEC = 2 * 3600;
/**
 * Options flow: the option money of the last 24 hours on Derive (the Flow page's figure, every recorded trade that
 * crossed the spread, market makers left out) and how much of it gains if the price rises or falls (calls bought and
 * puts sold against puts bought and calls sold, so a spread's halves offset), then the day's largest single trade as
 * one sentence (owner, 10 October 2026: the dot strip was "kind of hard to read"): the wallet's codename, what it
 * did in plain words, the legs, when, and the money paid or collected. The trade stays hidden until wallet classes
 * are ready, so market makers never show. An old file names its window.
 */
export function OptionsLive({ card, pop = false }) {
  const navigate = useNavigate();
  const { data, loading } = useData("flow.json");
  if (loading) return <Wait />;
  const coins = flowCoins(data?.by_coin);
  const total = coins.reduce((s, c) => s + c.total, 0);
  if (!(total > 0)) return <NotYet card={card} />;
  const most = coins[0];
  const cov = data.coverage;
  const part = cov?.ready === false && Number.isFinite(cov.fraction) ? Math.round(cov.fraction * 100) : null;
  const to = Number(cov?.end ?? data.generated_at);
  const stale = Number.isFinite(to) && Date.now() / 1000 - to > FLOW_FRESH_SEC;
  // The pop-out has room for the day's largest single trade under the map; the card keeps the map.
  const top = pop && data.classes_ready !== false ? largestTrade(data.large) : null;
  // On the card a bubble opens its coin's view on the Flow page (the card's own link stays the keyboard path).
  const pick = (e) => {
    const und = e.target.closest?.("[data-und]")?.dataset.und;
    if (und) { e.stopPropagation(); navigate(`/flow?coin=${und}`); }
  };
  return (
    <div className={`hl hl-options${top ? " with-trade" : ""}`}>
      <div className="hl-fig">
        <BigNum text={usd(total)} />
        <span className="hl-cap">
          <span>in options, {stale ? <><N>24h</N> to {when(to)} UTC</> : <N>24h</N>}{part != null && <> · <N>{part}%</N> of <N>24h</N> recorded</>}</span>
        </span>
        <span className="hl-flowlead">Most money: <b>{most.und}</b>, {leanWords(most)}</span>
      </div>
      <div className="hl-band hl-flowmap" aria-hidden={pop ? undefined : "true"} onClick={pop ? undefined : pick}>
        <FlowBubbles coins={coins} rMin={pop ? 12 : 10} rMax={pop ? 40 : 32} labels={pop ? 5 : 4}
          linkTo={pop ? (und) => `/flow?coin=${und}` : undefined} />
      </div>
      {top && <div className="hl-trade">
        <span className="hl-trade-k">Largest trade{stale ? "" : ", 24h"}</span>
        <span className="hl-trade-row">
          <WalletEmblem address={top.wallet} size={30} />
          <span className="hl-trade-what"><span title={top.who || undefined}><b>{codename(top.wallet)} {top.text}</b></span>
            <small>{top.detail} · {ago(top.ts)}</small></span>
          <span className="hl-trade-money"><small>{top.paid ? "paid" : "collected"}</small><N>{usd(top.money)}</N></span>
        </span>
      </div>}
    </div>
  );
}

export const HOME_LIVE = { positions: PositionsLive, radar: RadarLive, traders: TradersLive, markets: MarketsLive, posses: PossesLive, options: OptionsLive };
