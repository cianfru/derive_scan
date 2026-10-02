import { useState } from "react";
import { Link } from "react-router-dom";
import { Tabs } from "../components/ui.jsx";
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
        <div
          className={`research-object layer-${layer}`}
          aria-label="The three layers of Torq research"
        >
          <svg
            viewBox="0 0 560 470"
            role="img"
            aria-label="Schematic of three distinct research layers: daily price structure, options by expiry, wallet exposure"
          >
            <defs>
              <pattern
                id="research-grid"
                width="26"
                height="26"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M26 0H0V26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth=".5"
                />
              </pattern>
            </defs>
            <g className="object-guides">
              <path d="M45 342 287 452 524 322 M46 116 46 343 M524 96V322 M286 3V453" />
            </g>
            <g className="object-plane wallets">
              <path d="M46 300 278 207 524 286 287 398Z" />
              <path
                className="plane-grid"
                d="M46 300 278 207 524 286 287 398Z"
                fill="url(#research-grid)"
              />
              <path
                className="plane-ink"
                d="m137 306 35-14 45 16-34 15Z m91-37 35-14 86 29-36 17Z m91-36 35-14 59 20-36 16Z"
              />
              <text x="306" y="376" transform="rotate(-25 306 376)">
                Wallet exposure
              </text>
            </g>
            <g className="object-plane options">
              <path d="M46 210 278 117 524 196 287 308Z" />
              <path
                className="plane-grid"
                d="M46 210 278 117 524 196 287 308Z"
                fill="url(#research-grid)"
              />
              <path
                className="plane-line"
                d="m124 210 44-2 44-28 52-12 46 8 45 10 77-13 m-275 54 55 1 52-9 60-34 46 20 64 5"
              />
              <text x="306" y="285" transform="rotate(-25 306 285)">
                Options by expiry
              </text>
            </g>
            <g className="object-plane price">
              <path d="M46 120 278 27 524 106 287 218Z" />
              <path
                className="plane-grid"
                d="M46 120 278 27 524 106 287 218Z"
                fill="url(#research-grid)"
              />
              <path
                className="plane-line"
                d="m125 123 22-19 20 11 26-25 19 14 24-35 28 23 23-14 25 5 22-21 33 14 28-24 41 4"
              />
              <text x="306" y="195" transform="rotate(-25 306 195)">
                Daily structure
              </text>
            </g>
          </svg>
          <span className="object-caption">
            Three analytical layers, kept distinct
          </span>
        </div>
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
