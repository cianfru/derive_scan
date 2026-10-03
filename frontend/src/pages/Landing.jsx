import { Link } from "react-router-dom";
import ResearchLayers from "../components/ResearchLayers.jsx";
import { LayerIcon } from "../components/Chain.jsx";
import WalletTag from "../components/WalletTag.jsx";
import { Info } from "../components/ui.jsx";

// The landing page shows what Torq does and never what it currently reads: no prices, no coins,
// no counts, no results. Every figure is an illustration, labelled as one.

const Tag = () => <span className="lp-illus" aria-hidden="true">Illustration</span>;

/* ---------- 01 Regime: regimes along a price path, and the nine checks ---------- */
const PHASES = [
  // [key, label, x0, x1]
  ["ACCUM", "Accumulation", 16, 104],
  ["MARKUP", "Markup", 104, 214],
  ["REACC", "Re-accumulation", 214, 300],
  ["MARKUP", "Markup", 300, 360],
  ["BLOWOFF", "Blow-off", 360, 414],
  ["MARKDOWN", "Markdown", 414, 486],
  ["CAP", "Capitulation", 486, 560],
];
// Illustrative path: price against a rising trend line (y grows downward).
const TREND = (x) => 176 - x * 0.07;
const PATH_PTS = [
  [16, 0], [30, -4], [44, 3], [58, -2], [72, 4], [86, -3], [104, -2], [124, -14], [144, -22], [164, -34], [184, -42], [204, -52], [214, -50],
  [228, -36], [242, -22], [256, -10], [270, -6], [286, -14], [300, -22], [316, -40], [332, -58], [348, -72], [360, -80], [372, -100],
  [384, -112], [394, -120], [404, -110], [414, -96], [430, -62], [446, -30], [462, -4], [476, 16], [486, 26], [500, 44], [512, 62],
  [524, 70], [536, 64], [548, 68], [560, 66],
];
// The nine checks under the names the coin page uses (lib/regime.js checks()), in the engine's order.
const CHECKS = [["Regime", 1], ["Market", 1], ["Z-score", 1], ["BTC", 1], ["Heat", 0], ["Climax", 1], ["Funding", 1], ["Fear & Greed", 0], ["Stablecoins", 1]];

function RegimeFigure() {
  const d = PATH_PTS.map(([x, dy], i) => `${i ? "L" : "M"}${x},${(TREND(x) + dy).toFixed(1)}`).join(" ");
  return (
    <figure className="lp-figure lp-fig-regime">
      <Tag />
      <svg viewBox="0 0 576 236" className="lp-phase" role="img" aria-label="Illustration: a price path moving through the six regimes, from Accumulation to Capitulation, around its trend line">
        {PHASES.map(([k, label, x0, x1], i) => (
          <g key={i}>
            <rect x={x0} y="22" width={x1 - x0} height="196" className={`ph-band ph-${k}`} />
            <line x1={x0} x2={x0} y1="22" y2="218" className="ph-sep" />
            <text x={(x0 + x1) / 2} y={i % 2 ? 230 : 14} className="ph-label" textAnchor="middle">{label}</text>
          </g>))}
        <line x1="16" x2="560" y1={TREND(16)} y2={TREND(560)} className="ph-trend" />
        <text x="22" y={TREND(16) + 14} className="ph-note">Trend</text>
        <path d={d} className="ph-price" />
      </svg>
      <ul className="lp-phase-key" aria-hidden="true">
        {[["ACCUM", "Accumulation"], ["MARKUP", "Markup"], ["REACC", "Re-accumulation"], ["BLOWOFF", "Blow-off"], ["MARKDOWN", "Markdown"], ["CAP", "Capitulation"]].map(([k, l]) => <li key={k}><i className={`k-${k}`} />{l}</li>)}
      </ul>
      <ul className="lp-checks" aria-label="The nine checks behind a long signal (illustration)">
        {CHECKS.map(([name, on]) => (
          <li key={name} className={on ? "on" : ""}><i aria-hidden="true">{on ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.5 5 9.2 10 3" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : null}</i>{name}</li>))}
      </ul>
    </figure>
  );
}

/* ---------- 02 Wallets: from every wallet to the top tier ---------- */
// Made-up addresses: the codenames and emblems are drawn from them, not from real wallets.
const SAMPLE_WALLETS = ["0x5a1e000000000000000000000000000000000a17", "0x7c3b00000000000000000000000000000000f00d"];
const FUNNEL = [
  ["All", "Every wallet since December 2023", 100],
  ["out", "Market makers", 84],
  ["out", "Income sellers and hedgers", 70],
  ["out", "Too few trades to tell", 46],
  ["keep", "Directional, ranked by settled results", 28],
];
function WalletsFigure() {
  return (
    <figure className="lp-figure lp-fig-wallets">
      <Tag />
      <ol className="lp-funnel" aria-label="Illustration: every wallet narrowed to directional traders ranked by results">
        {FUNNEL.map(([kind, label, w]) => (
          <li key={label} className={`fn-${kind}`}>
            <span className="fn-bar"><i style={{ width: `${w}%` }} /></span>
            <span className="fn-label">{kind === "out" && <b aria-hidden="true">−</b>}{label}</span>
          </li>))}
        <li className="fn-top">
          <span className="fn-bar"><i style={{ width: "12%" }} /></span>
          <span className="fn-label">Top tier</span>
        </li>
      </ol>
      <div className="lp-tags" aria-hidden="true">
        {SAMPLE_WALLETS.map((a) => <WalletTag key={a} address={a} size={28} />)}
      </div>
    </figure>
  );
}

/* ---------- 03 Options: the priced range, walls and max pain ---------- */
function OptionsFigure() {
  // A price path to "now", then the middle half of priced outcomes widening with time.
  const past = "M16,124 L40,118 L62,128 L84,112 L104,116 L126,100 L146,108 L168,96 L190,104 L212,92 L232,98 L252,90";
  const nowX = 252, y0 = 90, x1 = 560;
  const up = (t) => y0 - 52 * Math.sqrt(t), down = (t) => y0 + 64 * Math.sqrt(t);   // downside edge wider: puts cost more
  const ts = Array.from({ length: 21 }, (_, i) => i / 20);
  const X = (t) => nowX + (x1 - nowX) * t;
  const upper = ts.map((t) => `${X(t).toFixed(1)},${up(t).toFixed(1)}`);
  const lower = ts.map((t) => `${X(t).toFixed(1)},${down(t).toFixed(1)}`);
  return (
    <figure className="lp-figure lp-fig-options">
      <Tag />
      <svg viewBox="0 0 576 220" className="lp-cone" role="img" aria-label="Illustration: the range option prices imply, widening after today, with the call wall above, the put wall below and max pain between">
        <line x1="16" x2="560" y1="26" y2="26" className="op-wall op-call" /><text x="560" y="20" textAnchor="end" className="op-label">Call wall</text>
        <line x1="16" x2="560" y1="196" y2="196" className="op-wall op-put" /><text x="560" y="212" textAnchor="end" className="op-label">Put wall</text>
        <line x1={nowX} x2="560" y1="104" y2="104" className="op-pain" /><text x="560" y="120" textAnchor="end" className="op-label">Max pain</text>
        <polygon points={[...upper, ...lower.reverse()].join(" ")} className="op-band" />
        <polyline points={ts.map((t) => `${X(t).toFixed(1)},${up(t).toFixed(1)}`).join(" ")} className="op-hi" />
        <polyline points={ts.map((t) => `${X(t).toFixed(1)},${down(t).toFixed(1)}`).join(" ")} className="op-lo" />
        <path d={past} className="op-price" />
        <line x1={nowX} x2={nowX} y1="34" y2="190" className="op-now" />
        <text x={nowX - 6} y="46" textAnchor="end" className="op-label">Now</text>
        <text x="440" y="76" textAnchor="middle" className="op-label op-mid">Middle half of priced outcomes</text>
      </svg>
      <div className="lp-meter" aria-hidden="true">
        <span>Puts richer</span><span className="mt-track"><i /></span><span>Calls richer</span>
      </div>
    </figure>
  );
}

/* ---------- Together: three reads side by side ---------- */
const ROWS = [
  [["up", "up", "up"], ["up", "up", "up"], "Agree"],
  [["up", "neutral", "defensive"], ["up", "up", "neutral"], "Mixed"],
  [["defensive", "defensive", "defensive"], ["defensive", "neutral", "defensive"], "Agree on 7 days"],
];
function SampleChain({ states }) {
  const agreed = states.every((s) => s === states[0]) && states[0] !== "neutral";
  return (
    <span className={`chain-mini${agreed ? ` agreed ${states[0]}` : ""}`}>
      {["engine", "wallets", "options"].map((k, i) => (
        <span key={k} className="chain-mini-cell">
          {i > 0 && <i className="chain-link" />}
          <b className={`chain-sq ${states[i]}`}><LayerIcon kind={k} size={15} /></b>
        </span>))}
    </span>
  );
}
function TogetherFigure() {
  return (
    <figure className="lp-figure lp-fig-together">
      <Tag />
      <div className="lp-board" role="img" aria-label="Illustration: three example rows of the board, each with a regime, wallets and options reading for 7 and 30 days">
        <div className="lb-head"><span /><span>7D</span><span>30D</span><span /></div>
        {ROWS.map(([a, b, note], i) => (
          <div key={i} className="lb-row">
            <span className="lb-coin"><i /><i /></span>
            <SampleChain states={a} /><SampleChain states={b} />
            <span className="lb-note">{note}</span>
          </div>))}
        <div className="lb-legend">
          <span><b className="chain-sq up" />Up</span><span><b className="chain-sq neutral" />Balanced</span><span><b className="chain-sq defensive" />Defensive</span>
        </div>
      </div>
    </figure>
  );
}

const LAYERS = [
  {
    kind: "engine", n: "01", name: "Regime", Figure: RegimeFigure,
    head: "Our own engine names the regime.",
    body: "Every coin is placed in one of six regimes, from Accumulation through Markup to Markdown, by how far price sits from its own trend, how fast it is moving and how volatile it is. Then nine checks score the case for a long entry.",
    proof: [
      ["Every close", "Recomputed minutes after each 4-hour and daily close, on Derive's perps."],
      ["Six regimes", "A new regime has to lead across closes before the label changes. One candle does not flip it."],
      ["Nine checks", "Regime, market, z-score, BTC, heat, climax, funding, Fear & Greed and stablecoin supply."],
    ],
    info: "The engine reads each perp's own price history: how far price sits from its long-term trend line (the z-score, in standard deviations), its momentum and its volatility. Funding and open interest come from Derive; Fear & Greed, stablecoin supply and BTC dominance are market-wide. Signals run from Strong long to Risk off; the nine checks score the long entries.",
  },
  {
    kind: "wallets", n: "02", name: "Wallets", Figure: WalletsFigure,
    head: "Every trade rebuilt. Only the best traders kept.",
    body: "We rebuilt every options trade on Derive since December 2023, wallet by wallet, and scored each trader on the options that have settled. Market makers, income sellers and hedgers are set aside. What remains are directional traders ranked by results, and you see what the best of them hold.",
    proof: [
      ["Since Dec 2023", "Every options trade on Derive, rebuilt per wallet and extended every day."],
      ["Market makers out", "Classed by fixed rules from their own trades, and never shown."],
      ["Settled results", "Premium paid and received plus what each option paid at expiry. Open trades count once they settle."],
    ],
    info: "Wallet classes follow rules fixed before any result: market makers (mostly maker fills, or both sides of the same option on the same day), income sellers (mostly selling out-of-the-money options) and hedgers (options offset with perps) are set aside. Directional traders need at least 20 option trades over at least 90 days. Each wallet appears under a made-up codename and emblem.",
  },
  {
    kind: "options", n: "03", name: "Options", Figure: OptionsFigure,
    head: "Where the market is positioned, in plain sight.",
    body: "Every 15 minutes we read the full option chain of every coin with options on Derive and turn it into a few pictures: the range option prices imply for each expiry, where open interest is stacked, whether puts or calls cost more, and who is paying up. Always market pricing, never our view.",
    proof: [
      ["Every 15 minutes", "Every coin's option chain read, and its shape recorded: volatility, skew, open interest."],
      ["The whole smile", "Priced ranges read from every quoted strike, not from one volatility number."],
      ["Takers only", "Premium paid and received by takers, with market makers left out."],
    ],
    info: "Priced ranges come from option prices across strikes for each expiry (where too few strikes are quoted, the at-the-money volatility stands in). They describe what the market is paying for, not our view. Call wall, put wall and max pain are read from open interest over the next 30 days.",
  },
];

function Layer({ kind, n, name, head, body, proof, info, Figure }, i) {
  return (
    <section key={kind} className={`wrap lp-layer${i % 2 ? " flip" : ""}`} aria-labelledby={`lp-${kind}`}>
      <div className="lp-copy">
        <p className="lp-eyebrow"><LayerIcon kind={kind} size={16} /><span>{n}</span>{name}</p>
        <h2 id={`lp-${kind}`}>{head}</h2>
        <p className="lp-body">{body}<Info label={`More about ${name}`}>{info}</Info></p>
        <ul className="lp-proof">
          {proof.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}
        </ul>
      </div>
      <Figure />
    </section>
  );
}

const FACTS = [
  ["4H · 1D", "engine run at every close"],
  ["Dec 2023", "every options trade since, rebuilt"],
  ["15 min", "every option chain read"],
  ["0", "market makers in the rankings"],
];

const FAQ = [
  ["What is Torq?", "Independent research on Derive: a price engine, a rebuilt history of every options trader, and the options market itself, read side by side for every coin with options on Derive."],
  ["Where does the data come from?", "Derive's public data: index prices, perps, option quotes and public trades. Market-wide context (Fear & Greed, stablecoin supply, BTC dominance) comes from public sources."],
  ["How often does it update?", "Option chains and trade flow every 15 minutes. The engine after every 4-hour and daily close. Trader history once a day."],
  ["Is this advice?", "No. Torq shows what prices, traders and option markets read. Market data and positioning for research, not investment advice."],
];

export default function Landing() {
  return (
    <div className="landing torq-landing">
      <section className="wrap torq-hero">
        <div className="torq-hero-copy">
          <p className="hero-purpose">Independent research for Derive traders</p>
          <h1>Read the market. <em>See the positioning.</em></h1>
          <p className="hero-description">
            Our engine names the regime. Derive's most profitable options traders show where they stand. Option prices show how the market is positioned. Side by side, for every coin with options on Derive.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">Open the markets <span aria-hidden="true">↗</span></Link>
            <Link className="text-link" to="/traders">Meet the traders</Link>
          </div>
        </div>
        <ResearchLayers />
      </section>

      <section className="wrap" aria-label="What Torq records">
        <div className="lp-facts">{FACTS.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
      </section>

      {LAYERS.map((l, i) => Layer(l, i))}

      <section className="wrap lp-layer lp-together" aria-labelledby="lp-together">
        <div className="lp-copy">
          <p className="lp-eyebrow"><span>+</span>Together</p>
          <h2 id="lp-together">Three independent reads. One row per coin.</h2>
          <p className="lp-body">Price, positioning and option prices come from different places and can disagree, so Torq never blends them into one score. Each layer gives its own reading, up, balanced or defensive, over 7 and 30 days, and the board lines them up. When all three agree, the row is framed.</p>
          <ul className="lp-proof">
            <li><b>Independent</b><span>Price history, wallet history, option prices: three sources, three readings.</span></li>
            <li><b>Never blended</b><span>No layer is averaged into another. The board only counts how many agree.</span></li>
            <li><b>Rules first</b><span>Whether top wallets lead price is tested in a study whose rules were fixed before any result. Until it reports, wallet positions are context.</span></li>
          </ul>
        </div>
        <TogetherFigure />
      </section>

      <section className="wrap lp-faq" aria-label="Questions">
        {FAQ.map(([q, a]) => (
          <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>))}
      </section>

      <section className="wrap landing-close">
        <h2>Three reads. Every coin with options.</h2>
        <div className="hero-cta">
          <Link className="btn primary" to="/markets">Open the markets <span aria-hidden="true">↗</span></Link>
          <Link className="text-link" to="/traders">Meet the traders</Link>
        </div>
      </section>
    </div>
  );
}
