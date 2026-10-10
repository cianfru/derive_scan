// The home cards drawn from Cowboy's own data (owner, 10 October 2026: the drawn icons looked cheap and the
// generated renders "too AI generated"; "the numbers are too small ... we have a lot of room ... just use
// it"). One widget language for every card: a figure row (one big figure, the one the card's page leads
// with, and a short caption that wraps under it rather than being cut) over a chart band that takes the
// rest of the card, drawn in real pixels (lib/homeLayout.js). Colour only on signed money; calls and puts
// in their own colours, regimes in theirs; orange stays interaction. While its file loads a card keeps a
// still placeholder of its size; without its file it shows its own title and "Not available yet".
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { REGIME, strike, usd } from "../lib/format.js";
import { REGIME_COLORS, REGIME_ORDER } from "../lib/regime.js";
import { radarPoint, viewReading } from "../lib/presentation.js";
import { regimeGroups } from "../lib/takeaway.js";
import { posseName } from "../lib/posses.js";
import { codename } from "../lib/walletName.js";
import { loadPositions } from "../lib/positions.js";
import { positionDone } from "../lib/positionView.js";
import { openPnl, pctText } from "../lib/homePnl.js";
import { compactCount, groupIconSize, radarLayout, swarm } from "../lib/homeLayout.js";
import { useFollowsDoc } from "../lib/follows.js";
import { money, signed } from "../lib/questions.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { useElementSize, useElementWidth } from "../lib/useElementWidth.js";
import { useFeeds } from "./Feeds.jsx";
import { regimeCounts, stripColumns } from "./StructureBand.jsx";
import { CoinIcon } from "./MarketVisuals.jsx";
import { WalletEmblem } from "./WalletTag.jsx";
import { Info } from "./ui.jsx";
import BigNum from "./BigNum.jsx";

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

/** Your positions: the P&L of what is open, as one percentage of what was paid, with the dollars under
 * it; the count when none has a price now; the owner's own words when nothing is open (with the answers
 * followed, when there are some). */
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
  if (r.pct == null) return (
    <div className="hl hl-pos">
      <span className="hl-hero"><BigNum className="xl" text={String(r.open)} /><span className="hl-of">open</span></span>
      <span className="hl-cap"><span>Not valued yet <Info label="Why there is no value now">Prices are paused or these answers are no longer
        on the board, so Derive's sell-back price is not shown.</Info></span></span>
    </div>
  );
  const side = r.pct >= 0 ? "up" : "down";
  const count = r.priced === r.open ? <><N>{r.open}</N> open</> : <><N>{r.priced}</N> of <N>{r.open}</N> valued</>;
  return (
    <div className={`hl hl-pos ${side}`}>
      <BigNum className={`xl ${side}`} text={pctText(r.pct)} />
      <span className="hl-cap">
        <span><N className={side}>{signed(r.pl)}</N> <i>on</i> <N>{money(r.paid, { cents: true })}</N></span>
        <span>{count}</span>
      </span>
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
/** "ETH 3,050 put · Oct 9 expiry · bought · $37.2K premium". */
function tradeTitle(t) {
  const m = /^([A-Z0-9]+)-\d{4}(\d{2})(\d{2})-([\d_.]+)-([CP])$/.exec(t.instrument || "");
  if (!m) return t.instrument || "";
  return `${m[1]} ${strike(Number(m[4].replace("_", ".")), "")} ${m[5] === "C" ? "call" : "put"} · ${MONTHS[+m[2] - 1]} ${+m[3]} expiry · `
    + `${t.direction === "buy" ? "bought" : "sold"} · ${usd(t.premium_usd)} premium`;
}
/** "7 Oct 08:30" in UTC. */
const when = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`; };
/** Past this age the flow file no longer reads as "the last 24 hours" and names its window instead. */
export const FLOW_FRESH_SEC = 2 * 3600;
/**
 * Options flow: the option premium takers bought on Derive over 24 hours (the Flow page's figure, every
 * recorded taker, not only the large trades), split between calls and puts, over a 24-hour strip of the
 * day's largest trades: each at its exact time, calls stacked above the line and puts below, filled when
 * bought, a ring when sold, sized by premium. The strip stays hidden until wallet classes are ready, so
 * market makers never show. An old file names its window ("24h to 7 Oct 08:30 UTC") instead of "now".
 */
export function OptionsLive({ card }) {
  const { data, loading } = useData("flow.json");
  const [band, box] = useElementSize({ w: 640, h: 90 });
  if (loading) return <Wait />;
  let calls = 0, puts = 0;
  for (const c of Object.values(data?.by_coin || {})) { calls += c.call?.buy_premium_usd || 0; puts += c.put?.buy_premium_usd || 0; }
  const bought = calls + puts;
  if (!(bought > 0)) return <NotYet card={card} />;
  const callPct = Math.round((calls / bought) * 100);
  const cov = data.coverage;
  const part = cov?.ready === false && Number.isFinite(cov.fraction) ? Math.round(cov.fraction * 100) : null;
  const from = Number(data.since), to = Number(cov?.end ?? data.generated_at);
  const stale = Number.isFinite(to) && Date.now() / 1000 - to > FLOW_FRESH_SEC;
  const trades = data.classes_ready === false || !(to > from) ? [] : (data.large || []).filter((t) => t.kind === "option" && Number.isFinite(t.premium_usd) && t.premium_usd > 0)
    .map((t) => ({ t, x: Math.max(0, Math.min(1, (t.ts / 1000 - from) / (to - from))) }));
  const split = <><span><N className="call">{callPct}%</N> calls</span> <span className="hl-sep">·</span> <span><N className="put">{100 - callPct}%</N> puts</span></>;
  // The strip in pixels: the line through the middle, the axis words' row under it when there is room.
  let strip = null;
  if (box && trades.length) {
    const axis = box.h >= 60 ? 16 : 0, h = box.h - axis, mid = h / 2;
    const rMax = Math.max(6, Math.min(22, mid * 0.62)), rMin = Math.min(3, rMax / 2);
    const maxP = Math.max(...trades.map(({ t }) => t.premium_usd));
    const biggest = trades.reduce((a, b) => (b.t.premium_usd > a.t.premium_usd ? b : a));
    const pad = rMax + 2;
    const dots = swarm(trades.map((d) => ({ ...d, top: d === biggest, side: /-C$/.test(d.t.instrument) ? -1 : 1,
      px: pad + d.x * (box.w - 2 * pad), r: rMin + (rMax - rMin) * Math.sqrt(d.t.premium_usd / maxP) })), { mid, lo: 0, hi: h })
      .sort((a, b) => a.r - b.r);
    strip = { dots, mid, axis };
  }
  return (
    <div className="hl hl-options">
      <div className="hl-fig">
        <BigNum text={usd(bought)} />
        <span className="hl-cap">
          <span>option premium bought, {stale ? <><N>24h</N> to {when(to)} UTC</> : <N>24h</N>}{part != null && <> · <N>{part}%</N> of <N>24h</N> recorded</>}</span>
          <span className="hl-split-line">{split}</span>
        </span>
        <span className="hl-split" aria-hidden="true">
          <span className="hl-split-bar"><i style={{ flexGrow: calls }} /><i style={{ flexGrow: puts }} /></span>
          <span className="hl-split-words">{split}</span>
        </span>
      </div>
      {trades.length > 0 && <div className="hl-band hl-strip" ref={band} aria-hidden="true">
        {strip && <>
          <i className="hl-strip-line" style={{ top: strip.mid }} />
          {strip.dots.map((d, i) => (
            <i key={`${d.t.ts}-${d.t.instrument}-${i}`} title={tradeTitle(d.t)}
              className={`hl-dot ${d.side < 0 ? "call" : "put"} ${d.t.direction === "buy" ? "buy" : "sell"}${d.top ? " top" : ""}`}
              style={{ left: `${d.px.toFixed(1)}px`, top: `${d.py.toFixed(1)}px`, width: 2 * d.r, height: 2 * d.r, "--x": d.x }} />
          ))}
          {strip.axis > 0 && <div className="hl-xw">{stale ? <><span>{when(from)}</span><span>{when(to)} UTC</span></>
            : <><span><N>24h</N> ago</span><span>now</span></>}</div>}
        </>}
      </div>}
    </div>
  );
}

export const HOME_LIVE = { positions: PositionsLive, radar: RadarLive, traders: TradersLive, markets: MarketsLive, posses: PossesLive, options: OptionsLive };
