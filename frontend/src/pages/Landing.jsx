import { Link } from "react-router-dom";
import ResearchLayers from "../components/ResearchLayers.jsx";
import { LayerIcon } from "../components/Chain.jsx";
import WalletTag from "../components/WalletTag.jsx";

// The landing page shows what Torq reads, never what it currently reads: no prices, no results.
// The illustrations are real components in neutral states.

function RegimeFigure() {
  return (
    <span className="chain-mini lt-chain" aria-hidden="true">
      {["engine", "wallets", "options"].map((k, i) => (
        <span key={k} className="chain-mini-cell">
          {i > 0 && <i className="chain-link" />}
          <b className="chain-sq lit"><LayerIcon kind={k} size={15} /></b>
        </span>))}
    </span>
  );
}

// Placeholder wallets: the codenames and emblems are drawn from made-up addresses.
const SAMPLE_WALLETS = ["0x5a1e000000000000000000000000000000000a17", "0x7c3b00000000000000000000000000000000f00d"];
function WalletsFigure() {
  return (
    <div className="lt-wallets" aria-hidden="true">
      {SAMPLE_WALLETS.map((a) => <WalletTag key={a} address={a} size={28} />)}
      <span className="lt-cohort"><i /></span>
    </div>
  );
}

function OptionsFigure() {
  // A fan of priced ranges, widening with time. Unlabelled: shape only.
  const rows = [[0.46, 0.54], [0.41, 0.59], [0.36, 0.64], [0.31, 0.69], [0.26, 0.74]];
  return (
    <svg className="lt-range" viewBox="0 0 240 92" aria-hidden="true">
      <line x1="120" y1="2" x2="120" y2="90" className="lt-mid" />
      {rows.map(([a, b], i) => {
        const y = 8 + i * 17, x1 = 240 * a, x2 = 240 * b;
        return (
          <g key={i}>
            <rect x={x1} y={y} width={x2 - x1} height="8" className="lt-band" />
            <rect x={x1} y={y} width="2" height="8" className="lt-lo" />
            <rect x={x2 - 2} y={y} width="2" height="8" className="lt-hi" />
          </g>);
      })}
    </svg>
  );
}

const LAYERS = [
  ["engine", "Regime", "Where price sits in its cycle.", RegimeFigure],
  ["wallets", "Wallets", "What the best options traders hold.", WalletsFigure],
  ["options", "Options", "The ranges option prices imply.", OptionsFigure],
];

export default function Landing() {
  return (
    <div className="landing torq-landing">
      <section className="wrap torq-hero">
        <div className="torq-hero-copy">
          <p className="hero-purpose">Independent research for Derive traders</p>
          <h1>Read the market. <em>See the positioning.</em></h1>
          <p className="hero-description">
            Three layers on every coin with options on Derive: the price regime, the wallets behind the exposure, and what option prices lean towards.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">Enter the workspace <span aria-hidden="true">↗</span></Link>
            <Link className="text-link" to="/traders">Meet the traders</Link>
          </div>
        </div>
        <ResearchLayers />
      </section>
      <section className="wrap layers-teaser" aria-label="The three layers">
        {LAYERS.map(([kind, name, line, Figure]) => (
          <article key={kind}>
            <div className="lt-head"><LayerIcon kind={kind} size={18} /><h3>{name}</h3></div>
            <p>{line}</p>
            <div className="lt-figure"><Figure /></div>
          </article>))}
      </section>
      <section className="wrap landing-close">
        <h2>Three layers. Every coin with options.</h2>
        <Link className="btn primary" to="/markets">Enter the workspace <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}
