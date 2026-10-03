import { Link, useOutletContext } from "react-router-dom";
import ResearchLayers from "../components/ResearchLayers.jsx";
import { LayerIcon } from "../components/Chain.jsx";
import { Logo } from "../components/Shell.jsx";

// The landing page explains what Torq reads, never what it currently reads: results live behind it.
const LAYERS = [
  ["engine", "01", "Regime", "A regime engine reads every market after each 4-hour and daily close.",
    ["Trend, stretch, heat and exhaustion", "Seven regimes, from accumulation to blow-off", "One call per close"]],
  ["wallets", "02", "Wallets", "Every options trade on Derive since 2023, rebuilt wallet by wallet.",
    ["Traders ranked by results, market makers left out", "Cohorts from Money Printer to Giga-Rekt", "What the best wallets hold, by expiry"]],
  ["options", "03", "Options", "What option prices say about the move the market is paying for.",
    ["The range priced in for each expiry", "Where open interest stacks up", "Who pays more for protection"]],
];

export default function Landing() {
  const { theme } = useOutletContext();
  return (
    <div className="landing torq-landing">
      <section className="wrap torq-hero">
        <div className="torq-hero-copy">
          <p className="hero-purpose">Independent research for Derive traders</p>
          <h1>Read the<br />market.<br /><em>See the<br />positioning.</em></h1>
          <p className="hero-description">
            Three layers on every coin with options on Derive: the price regime, the wallets behind the exposure, and what option prices lean towards.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">Enter the workspace <span>↗</span></Link>
            <Link className="text-link" to="/traders">Meet the traders</Link>
          </div>
        </div>
        <ResearchLayers />
      </section>
      <section className="wrap layers-lead">
        <h2>Three layers. One read.</h2>
        <p>Each one stands on its own. Inside, they line up side by side for the next 7 and 30 days, coin by coin.</p>
      </section>
      <section className="wrap layers-teaser">
        {LAYERS.map(([kind, n, name, line, points]) => (
          <article key={kind}>
            <div className="lt-head"><span>{n}</span><LayerIcon kind={kind} size={22} /></div>
            <h3>{name}</h3>
            <p>{line}</p>
            <ul>{points.map((x) => <li key={x}>{x}</li>)}</ul>
          </article>))}
      </section>
      <section className="wrap research-promise">
        <div className="brand-signature">
          <Logo theme={theme} height={95} />
          <span>DERIVE RESEARCH / INDEPENDENT BY DESIGN</span>
        </div>
        <div>
          <h2>The reading is<br />only the start.</h2>
          <p>Start from a coin. Read its regime, see who holds it, then what options price in. Every step opens the evidence behind it.</p>
          <Link className="text-link" to="/markets">Open the workspace ↗</Link>
        </div>
      </section>
    </div>
  );
}
