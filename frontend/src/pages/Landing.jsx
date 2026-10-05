import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LayerIcon } from "../components/Chain.jsx";
import WalletTag from "../components/WalletTag.jsx";
import { Info } from "../components/ui.jsx";
import { HatMark, NeonSign } from "../components/Brand.jsx";
import { REGIME } from "../lib/format.js";
import { QUESTIONS_ON } from "../lib/flags.js";
import { oneTapOffered } from "../lib/pilot.js";
import SaloonDemo from "../components/SaloonDemo.jsx";
import "../landing.css";

// The landing page shows what Cowboy does and never what it currently reads: no prices, no coins,
// no counts, no results. Every figure is an illustration, labelled as one; the Saloon example
// (components/SaloonDemo.jsx) is the only place with dollar figures, all made up. The sign carries the
// character (neon, flicker, light spill); everything below it is as calm as the app.

const Tag = () => <span className="lp-illus" aria-hidden="true">Illustration</span>;

/* ---------- 01 Regime: regimes along a price path, and the nine checks ---------- */
const PHASES = [
  // [key, label, x0, x1]
  ["ACCUM", REGIME.ACCUM, 16, 104],
  ["MARKUP", REGIME.MARKUP, 104, 214],
  ["REACC", REGIME.REACC, 214, 300],
  ["MARKUP", REGIME.MARKUP, 300, 360],
  ["BLOWOFF", REGIME.BLOWOFF, 360, 414],
  ["MARKDOWN", REGIME.MARKDOWN, 414, 486],
  ["CAP", REGIME.CAP, 486, 560],
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
      <svg viewBox="0 0 576 236" className="lp-phase" role="img" aria-label="Illustration: a price path moving through the six regimes, from building a base to washed out, around its trend line">
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
        {["ACCUM", "MARKUP", "REACC", "BLOWOFF", "MARKDOWN", "CAP"].map((k) => [k, REGIME[k]]).map(([k, l]) => <li key={k}><i className={`k-${k}`} />{l}</li>)}
      </ul>
      <ul className="lp-checks" aria-label="The nine checks behind an up-setup (illustration)">
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

/* ---------- 03 Options: one idea first — the range embedded in prices ---------- */
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
      <div className="lp-cone-wrap">
      <svg viewBox="0 0 576 220" className="lp-cone" role="img" aria-label="Illustration: price history up to today, followed by a widening range implied by option prices">
        <polygon points={[...upper, ...lower.reverse()].join(" ")} className="op-band" />
        <polyline points={ts.map((t) => `${X(t).toFixed(1)},${up(t).toFixed(1)}`).join(" ")} className="op-hi" />
        <polyline points={ts.map((t) => `${X(t).toFixed(1)},${down(t).toFixed(1)}`).join(" ")} className="op-lo" />
        <path d={past} className="op-price" />
        <line x1={nowX} x2={nowX} y1="34" y2="190" className="op-now" />
      </svg>
        <span className="lp-cone-now">Now</span>
        <div className="lp-cone-axis"><span>Price history</span><span>Later expiries</span></div>
      </div>
      <div className="lp-meter" aria-hidden="true">
        <span>Puts richer</span><span className="mt-track"><i /></span><span>Calls richer</span>
      </div>
      <figcaption className="lp-figure-caption">The range comes from option prices. It is market pricing, not a view on where price goes next.</figcaption>
    </figure>
  );
}


/* ---------- The three layers at a glance: one small illustration each (no market data) ---------- */
// Regime: one price line coloured by the phase it is in.
const MINI_PHASES = [["ACCUM", 0, 104], ["MARKUP", 104, 216], ["REACC", 216, 320]];
const MINI_PATH = [[0, 86], [14, 82], [28, 88], [42, 83], [56, 87], [70, 82], [84, 85], [104, 82], [122, 72], [140, 64], [158, 52],
  [176, 44], [196, 32], [216, 24], [232, 34], [248, 44], [264, 40], [280, 50], [296, 47], [320, 54]];
function seg(x0, x1) {
  const pts = MINI_PATH.filter(([x]) => x >= x0 && x <= x1);
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
}
function RegimeMini() {
  return (
    <>
      <svg viewBox="0 0 320 100" className="lp-mini-svg" role="img" aria-label="Illustration: a price line coloured by regime, building a base, then trending up, then cooling off">
        {MINI_PHASES.map(([k, x0, x1]) => <rect key={k} x={x0} y="8" width={x1 - x0} height="92" className={`mini-band mini-${k}`} />)}
        {MINI_PHASES.map(([k, x0, x1]) => <path key={k} d={seg(x0, x1)} className={`mini-line mini-${k}`} />)}
      </svg>
      <ol className="lp-mini-phases" aria-hidden="true" style={{ gridTemplateColumns: MINI_PHASES.map(([, a, b]) => `${b - a}fr`).join(" ") }}>
        {MINI_PHASES.map(([k]) => <li key={k} className={`mini-${k}`}>{REGIME[k]}</li>)}
      </ol>
    </>
  );
}
// Wallets: fourteen made-up wallets, more positioned up than down.
const MINI_WALLETS = [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0];
function WalletsMini() {
  const ups = MINI_WALLETS.filter(Boolean).length;
  return (
    <div className="lp-mini-wallets" role="img" aria-label="Illustration: how profitable wallets are positioned, more up than down">
      <div className="mw-dots" aria-hidden="true">
        {[...MINI_WALLETS].sort((a, b) => b - a).map((up, i) => (
          <i key={i} className={up ? "up" : "down"}><svg viewBox="0 0 10 10"><path d={up ? "M5 2 8.5 7.5h-7z" : "M5 8 1.5 2.5h7z"} /></svg></i>))}
      </div>
      <div className="mw-bar" aria-hidden="true">
        <span className="up" style={{ flexGrow: ups }} /><span className="down" style={{ flexGrow: MINI_WALLETS.length - ups }} />
      </div>
      <div className="mw-ends" aria-hidden="true"><span className="up">Positioned up</span><span className="down">Positioned down</span></div>
    </div>
  );
}
// Options: price up to now, then the range option prices imply, widening with time.
function OptionsMini() {
  const nowX = 132, y0 = 52, x1 = 316;
  const ts = Array.from({ length: 13 }, (_, i) => i / 12);
  const X = (t) => nowX + (x1 - nowX) * t;
  const up = ts.map((t) => [X(t), y0 - 34 * Math.sqrt(t)]);
  const lo = ts.map((t) => [X(t), y0 + 40 * Math.sqrt(t)]);
  const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div className="lp-mini-range">
      <svg viewBox="0 0 320 104" className="lp-mini-svg" role="img" aria-label="Illustration: price up to now, then the range option prices imply, with its upper and lower ends">
        <polygon points={pts([...up, ...[...lo].reverse()])} className="mini-band-range" />
        <polyline points={pts(up)} className="mini-hi" />
        <polyline points={pts(lo)} className="mini-lo" />
        <path d="M4,64 L22,60 L40,66 L58,56 L76,59 L94,50 L112,55 L132,52" className="mini-price" />
        <line x1={nowX} x2={nowX} y1="8" y2="100" className="mini-now" />
      </svg>
      <span className="mr-label mr-hi" aria-hidden="true">Upper end</span>
      <span className="mr-label mr-lo" aria-hidden="true">Lower end</span>
      <span className="mr-label mr-now" aria-hidden="true">Now</span>
    </div>
  );
}
const MINIS = [
  ["engine", "01", "Regime", RegimeMini, "The engine names the phase price is in, from building a base to cooling off."],
  ["wallets", "02", "Wallets", WalletsMini, "How profitable wallets are positioned. Context, not a signal."],
  ["options", "03", "Options", OptionsMini, "The range option prices imply, with its upper and lower ends. Market pricing, not a view."],
];
function LayerMinis() {
  return (
    <ol className="lp-minis" aria-label="The three layers at a glance">
      {MINIS.map(([kind, n, name, Mini, line]) => (
        <li key={kind} className={`lp-mini lp-mini-${kind}`}>
          <div className="lp-mini-head"><span className="lp-mini-n">{n}</span><LayerIcon kind={kind} size={16} /><b>{name}</b><Tag /></div>
          <Mini />
          <p>{line}</p>
        </li>))}
    </ol>
  );
}

const LAYERS = [
  {
    kind: "engine", name: "Regime", Figure: RegimeFigure,
    question: "What is price doing?", head: "Read the cycle, not one candle.",
    body: "From building a base to trending down, the engine names each coin’s regime. Compare the daily structure with its 4-hour context.",
    detail: "Nine checks behind every up-setup",
    info: "The engine reads price history, distance from trend and volatility after each 4-hour and daily close. A new regime has to hold across closes before the label changes. The nine checks are shown in the illustration; they describe the setup, not a trade instruction.",
    href: "/markets", link: "Explore the markets",
  },
  {
    kind: "wallets", name: "Wallets", Figure: WalletsFigure,
    question: "Who is positioned, and how?", head: "Follow positions with a track record.",
    body: "Options trades rebuilt wallet by wallet. Directional traders ranked on settled results, with market makers, income sellers and hedgers set aside.",
    detail: "Positioning is context",
    info: "Wallet history is rebuilt from December 2023 and extended daily. Fixed rules separate trading styles before ranking. The study of whether these wallets lead price is still underway. Historical results and current positions are context, not a trade instruction. The names and brands here are made up.",
    href: "/traders", link: "Meet the traders",
  },
  {
    kind: "options", name: "Options", Figure: OptionsFigure,
    question: "What does the market price in?", head: "See the cost of uncertainty.",
    body: "Read the range embedded in option prices, the cost of protection and where open positions sit. Choose an expiry to put each reading in context.",
    detail: "Market pricing, explained",
    info: "The illustrated band contains the middle half of outcomes priced by options. Puts richer means downside protection costs more in volatility terms than comparable calls. Neither the range nor the cost of protection is a view on the next price move.",
    href: "/options", link: "Explore options",
  },
];

function ResearchExplorer() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef([]);
  function selectWithKey(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % LAYERS.length;
    else if (event.key === "ArrowLeft") next = (index + LAYERS.length - 1) % LAYERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = LAYERS.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }
  return (
    <section id={QUESTIONS_ON ? "research" : "how"} className="wrap lp-research" aria-labelledby="lp-research-title">
      <div className="lp-research-intro">
        <div>
          <p className="lp-kicker">The research behind the read</p>
          <h2 id="lp-research-title">Three perspectives.<br />Keep the whole picture.</h2>
        </div>
        <div>
          <p className="lp-body">Price, wallets and options tell different stories. Read them in order, side by side. Each keeps its own meaning.</p>
          <p className="lp-research-principle">Independent readings. Never one blended score.</p>
        </div>
      </div>
      <LayerMinis />
      <div className="lp-research-tabs" role="tablist" aria-label="Research layers">
        {LAYERS.map((layer, i) => (
          <button key={layer.kind} ref={(el) => { tabs.current[i] = el; }} role="tab"
            id={`research-tab-${layer.kind}`} aria-controls={`research-panel-${layer.kind}`}
            aria-selected={selected === i} tabIndex={selected === i ? 0 : -1}
            onClick={() => setSelected(i)} onKeyDown={(event) => selectWithKey(event, i)}>
            <span className="lp-tab-name"><LayerIcon kind={layer.kind} size={20} />{layer.name}</span>
            <span className="lp-tab-question">{layer.question}</span>
          </button>
        ))}
      </div>
      {LAYERS.map(({ kind, head, body, detail, info, href, link, Figure }, i) => (
        <div key={kind} role="tabpanel" id={`research-panel-${kind}`} aria-labelledby={`research-tab-${kind}`}
          hidden={selected !== i} tabIndex={0} className="lp-research-panel">
          <div className="lp-research-copy">
            <h3>{head}</h3>
            <p className="lp-body">{body}</p>
            <p className="lp-detail">{detail}<Info label={`More about ${LAYERS[i].name}`}>{info}</Info></p>
            <Link className="lp-text-link" to={href}>{link}<span aria-hidden="true">↗</span></Link>
          </div>
          <Figure />
        </div>
      ))}
    </section>
  );
}

const FAQ = [
  ["What is Cowboy?", QUESTIONS_ON
    ? "Cowboy makes Derive’s price outcomes easier to explore. The Saloon shows costs and settlement payouts, with separate research on price regimes, wallet positioning and options. " + (oneTapOffered()
      ? "You trade in one tap from Cowboy, with your own wallet; trades settle on Derive."
      : "Trades settle on Derive, in your own account.")
    : "Independent research on Derive: price regimes, wallet positioning and options, read side by side."],
  [QUESTIONS_ON ? "Is a partial payout still a loss?" : "Do I need to trade options?", QUESTIONS_ON
    ? "It can be. Payout is the total returned at settlement. Profit or loss is that payout minus your total cost, including fees. A payout below your cost is a loss. Closing before settlement is valued differently."
    : "No. The research uses plain labels and diagrams, with explanations beside unfamiliar terms."],
  ["Where does the data come from?", "Derive’s public prices, option quotes and trades. Wider market context comes from public sources. The examples on this page are illustrations, not current market readings."],
  ["How often does it update?", "Options and flow every 15 minutes. The engine after each 4-hour and daily close. Wallet history once a day. Each research view shows its own time."],
  ["Does Cowboy trade for me?", QUESTIONS_ON
    ? (oneTapOffered()
      ? "No. You choose and confirm every trade. One tap sends it to Derive from your own wallet and account: both options fill together at one price, or nothing fills. Cowboy never holds your money or your keys."
      : "Not yet: one-tap trading is coming. For now the Saloon lists the two option orders to place on Derive. The completed position’s defined cost applies after both orders fill. While only the first has filled, the cash needed and loss can be larger.")
    : "No. Cowboy reads public market data. Any trade is yours to place on Derive."],
  ["Are the readings trade advice?", "No. The three research layers are context and stay separate. The study of whether wallet positioning leads price is still underway. Nothing here is investment advice."],
];

const EntryButton = () => (QUESTIONS_ON
  ? <Link className="btn primary lg" to="/saloon">Enter the Saloon</Link>
  : <Link className="btn primary lg" to="/markets">Open the markets</Link>);

function SaloonIntro() {
  return (
    <section id="how" className="wrap lp-saloon-draft" aria-labelledby="lp-saloon">
      <div className="lp-saloon-copy">
        <p className="lp-kicker"><HatMark size={23} />The Saloon</p>
        <h2 id="lp-saloon">Pick higher or lower.<br />Know your cost first.</h2>
        <p className="lp-body">Choose a coin, a date and a price level. See the full cost and what the position pays at settlement before you place anything.</p>
        <ol className="lp-saloon-steps">
          <li><span>Choose your outcome</span><small>Higher or lower at settlement.</small></li>
          <li><span>Understand the payout</span><small>Full, partial or none. Cost always counts.</small></li>
          <li><span>Check the context</span><small>Regime, wallets and options alongside.</small></li>
        </ol>
        {oneTapOffered()
          ? <p className="lp-execution-note">One tap: both options fill together at one price, or nothing fills.<Info label="How one tap works">The demo describes a position held to settlement. One tap sends the whole answer to Derive as one package from your own wallet and account, at one firm price you see first. Closing early is valued differently.</Info></p>
          : <p className="lp-execution-note">One-tap trading is coming. For now, two option orders on Derive.<Info label="How the orders work">The demo describes a completed two-option position held to settlement. Both orders need to fill for its defined cost to apply. With only the first order filled, cash needed and loss can be larger. Closing early is valued differently.</Info></p>}
      </div>
      <SaloonDemo />
    </section>
  );
}

export default function Landing() {
  return (
    <div className="landing cowboy-landing cowboy-draft">
      <section className="hero-stage" aria-labelledby="lp-hero">
        <div className="hero-inner">
          <p className="hero-eyebrow">{QUESTIONS_ON ? `Engine · Traders · Options · ${oneTapOffered() ? "One tap" : "Saloon"}` : "Independent trader intelligence on Derive."}</p>
          <div className="sign-wrap"><NeonSign /></div>
          <div className="hero-row">
            <h1 id="lp-hero">Know where<br />the herd stands.{QUESTIONS_ON && <span className="hero-then"> Then pick your side.</span>}</h1>
            <div className="hero-side">
              <p className="hero-description">{QUESTIONS_ON
                ? `The regime, the traders and the options at a glance. Then higher or lower ${oneTapOffered() ? "in one tap" : "on Derive"}, cost shown first.`
                : "Understand the price cycle, follow wallet positioning and see what the options market prices in."}</p>
              <div className="hero-cta">
                <EntryButton />
                <a className="lp-hero-link" href="#how">See how it works<span aria-hidden="true">↓</span></a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {QUESTIONS_ON && <SaloonIntro />}
      <ResearchExplorer />

      <section className="wrap lp-faq" aria-labelledby="lp-faq">
        <div className="lp-faq-heading"><h2 id="lp-faq">Before you saddle up.</h2><p>A few things worth knowing.</p></div>
        <div className="lp-faq-list">
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>))}
        </div>
      </section>

      <section className="wrap landing-close">
        <div><HatMark size={48} className="close-hat" /><h2>{QUESTIONS_ON ? "Find your seat in the Saloon." : "Get a read on the market."}</h2></div>
        <EntryButton />
      </section>
    </div>
  );
}
