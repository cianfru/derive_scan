import { Link } from "react-router-dom";
import { Arrow } from "./ui.jsx";
import { LAYERS, LayerIcon, LayerTile, chainAgreed } from "./Chain.jsx";
import "../coin-detail.css";

/** The coin's three layers for both windows, as one flat card: the coin page's overview, and the
 * Saloon's context beside a trade (wrapped in `.coin-detail`, where its styles live). Both windows
 * keep their engine cadence visible, even when their current readings match. `footer` replaces the
 * coin page's footer line. */
export default function CoinOverview({ alignment, und, footer = null, label = "Three layers" }) {
  if (!alignment) return null;
  return (
    <nav className="journey-strip cd-overview" aria-label={label}>
      <div className="cd-overview-head">
        <span>Window</span>
        {LAYERS.map(([kind, name, anchor]) => <Link key={kind} className="cd-layer-link" to={`/coin/${und}#${anchor}`}><LayerIcon kind={kind} size={15} />{name}<Arrow /></Link>)}
      </div>
      {["7d", "30d"].map((h) => {
        const agreed = chainAgreed(alignment, h);
        return (
          <div key={h} className={`journey-row cd-overview-row${agreed ? " agreed" : ""}`}>
            <div className="cd-window"><span>{h === "7d" ? "7 days" : "30 days"}</span><small>{h === "7d" ? "4H engine" : "1D engine"}</small>{agreed && <small className="cd-agreement">All agree</small>}</div>
            {LAYERS.map(([kind]) => <LayerTile key={kind} alignment={alignment} horizon={h} kind={kind} sub="detail" icon={false} />)}
          </div>);
      })}
      <div className="cd-overview-footer">{footer || <><span>Context, not a signal</span><Link to={`/coin/${und}#metric-history`}>Explore history<Arrow /></Link></>}</div>
    </nav>
  );
}
