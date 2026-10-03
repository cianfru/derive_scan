import { Link, useOutletContext } from "react-router-dom";
import HeroChain from "../components/HeroChain.jsx";
import { Logo } from "../components/Shell.jsx";
export default function Landing() {
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
            Every coin with options on Derive, read in three steps: the price
            regime, the wallets behind the exposure, and what option prices lean towards.
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
        <HeroChain />
      </section>
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
            Start from a coin. Read its regime, see who holds it, then what
            options price in. Every step opens the evidence behind it.
          </p>
          <Link className="text-link" to="/markets">
            Open the workspace ↗
          </Link>
        </div>
      </section>
    </div>
  );
}
