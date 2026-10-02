import { useState } from "react";
import { Link } from "react-router-dom";
import { Tabs } from "../components/ui.jsx";
import ResearchLayers from "../components/ResearchLayers.jsx";
const LAYERS = {
  price: {
    title: "Structure before signal.",
    copy: "Start with the daily regime. Inspect trend, extension and the conditions behind each engine reading.",
    link: "/markets",
    cta: "Explore markets",
  },
  options: {
    title: "Read the price of risk.",
    copy: "Compare expiries, volatility and skew. See where open interest sits and what the options market is pricing.",
    link: "/options",
    cta: "Explore options",
  },
  wallets: {
    title: "Follow exposure, not a rank.",
    copy: "Open a trader cohort. See its options exposure by asset and expiry, with the quality of the underlying history in view.",
    link: "/traders",
    cta: "Explore traders",
  },
};
export default function Landing() {
  const [layer, setLayer] = useState("price");
  const selected = LAYERS[layer];
  return (
    <div className="landing torq-landing">
      <section className="wrap torq-hero">
        <div className="torq-hero-copy">
          <p className="hero-purpose">
            Independent research for Derive traders
          </p>
          <h1>
            Read the market.
            <br />
            See the positioning.
          </h1>
          <p className="hero-description">
            Daily structure. Options pricing. The wallets behind the exposure.
            One place to inspect the evidence.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">
              Enter the workspace
            </Link>
            <Link className="text-link" to="/radar">
              Explore radar
            </Link>
          </div>
        </div>
        <ResearchLayers layer={layer} onSelect={setLayer} />
      </section>
      <section className="wrap research-intro">
        <div className="research-tabs">
          <Tabs
            label="Explore Torq research"
            value={layer}
            onChange={setLayer}
            items={[
              ["price", "Price engine"],
              ["options", "Options market"],
              ["wallets", "Trader positioning"],
            ]}
          />
        </div>
        <div className="research-copy" aria-live="polite">
          <h2>{selected.title}</h2>
          <p>{selected.copy}</p>
          <Link className="text-link" to={selected.link}>
            {selected.cta}
          </Link>
        </div>
      </section>
      <section className="wrap research-promise">
        <div className="torq-signature" aria-hidden="true">
          TORQ
        </div>
        <div>
          <h2>The reading is only the start.</h2>
          <p>
            Every signal opens into its evidence. Every exposure has an expiry.
            Every incomplete reading tells you what is missing.
          </p>
          <Link className="btn" to="/markets">
            Open daily markets
          </Link>
        </div>
      </section>
    </div>
  );
}
