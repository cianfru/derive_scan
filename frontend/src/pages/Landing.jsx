import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import ResearchLayers from "../components/ResearchLayers.jsx";
import BitcoinExamples from "../components/BitcoinExamples.jsx";
import { Logo } from "../components/Shell.jsx";
export default function Landing() {
  const [layer, setLayer] = useState("price");
  const { theme } = useOutletContext();
  return (
    <div className="landing torq-landing">
      <section className="wrap torq-hero">
        <div className="torq-hero-copy">
          <p className="hero-purpose">
            Independent research for Derive traders
          </p>
          <h1>
            Read the
            <br />
            market.
            <br />
            <em>
              See the
              <br />
              positioning.
            </em>
          </h1>
          <p className="hero-description">
            Price structure. The cost of risk.
            <br />
            The wallets behind the exposure.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">
              Enter the workspace <span>↗</span>
            </Link>
            <Link className="text-link" to="/radar">
              Explore radar
            </Link>
          </div>
        </div>
        <ResearchLayers layer={layer} onSelect={setLayer} />
      </section>
      <BitcoinExamples onSelect={setLayer} />
      <section className="wrap research-promise">
        <div className="brand-signature">
          <Logo theme={theme} height={95} />
          <span>DERIVE RESEARCH / INDEPENDENT BY DESIGN</span>
        </div>
        <div>
          <h2>
            The reading is
            <br />
            only the start.
          </h2>
          <p>
            Trace a setup back to its conditions. Follow exposure through
            expiry. Look inside the evidence.
          </p>
          <Link className="text-link" to="/markets">
            Open the workspace ↗
          </Link>
        </div>
      </section>
    </div>
  );
}
