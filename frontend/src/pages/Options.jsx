import { useNavigate, Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, utc } from "../lib/format.js";
import { Asset } from "../components/MarketVisuals.jsx";
import {
  MoveBand,
  SkewInstrument,
  VolatilityTenors,
} from "../components/OptionsInstruments.jsx";
import { Loading, Failed, Info } from "../components/ui.jsx";
import { openMarketRow } from "../lib/explain.js";

export default function Options() {
  const nav = useNavigate();
  const { data, error } = useData("markets.json");
  if (!data)
    return (
      <div className="wrap page">
        {error ? <Failed error={error} /> : <Loading />}
      </div>
    );
  const coins = data.coins
    .filter((c) => c.options)
    .sort(
      (a, b) =>
        b.options.option_oi_contracts * (b.price || 0) -
        a.options.option_oi_contracts * (a.price || 0),
    );
  const open = (e, und) =>
    openMarketRow(e, (path) => nav(`${path}#options-detail`), und);
  return (
    <div className="wrap page options-page">
      <div className="page-heading">
        <div>
          <span className="section-code">THE PRICE OF RISK</span>
          <h1>Options</h1>
          <p className="sub">
            Read the movement priced in. Compare protection. Locate the open
            positions.
          </p>
        </div>
        <div className="close-stamp">
          <span>{coins.length} Derive surfaces</span>
          <b>{utc(data.generated_at)}</b>
        </div>
      </div>
      <div className="options-reading-guide">
        <span>
          <b>01</b> Movement <small>30-day ATM scale</small>
        </span>
        <span>
          <b>02</b> Protection <small>Call versus put IV</small>
        </span>
        <span>
          <b>03</b> Positioning <small>Open contracts by strike</small>
        </span>
        <Info label="How to use the options workspace">
          Each card separates the amount of movement priced into options, the
          relative cost of protection and the distribution of open interest.
          These are different measurements. Open a market to choose an exact
          expiry and inspect its strikes, model ranges and collected trade flow.
        </Info>
      </div>
      <div className="options-dossiers">
        {coins.map((c) => {
          const o = c.options,
            lv = o.levels,
            historical =
              o.status !== "ready" || Date.now() / 1000 - o.ts > 1800;
          return (
            <article
              key={c.und}
              className="option-dossier"
              tabIndex={0}
              aria-label={`Open ${c.und} options`}
              onClick={(e) => open(e, c.und)}
              onKeyDown={(e) => open(e, c.und)}
            >
              <header>
                <Link
                  className="option-market-link"
                  to={`/coin/${c.und}#options-detail`}
                >
                  <Asset und={c.und} />
                </Link>
                <div className="dossier-index">
                  <strong>${price(c.price)}</strong>
                  <span>Index</span>
                </div>
                <span className="dossier-arrow" aria-hidden="true">
                  ↗
                </span>
              </header>
              <div className="dossier-body">
                <MoveBand index={c.price} iv={o.atm_iv_30d} />
                <div className="dossier-secondary">
                  <SkewInstrument rr={o.rr25_30d} />
                  <VolatilityTenors features={o} />
                </div>
              </div>
              <div className="dossier-positioning">
                <span className="label">
                  OI concentrations · next {lv?.days || 30} days{" "}
                  <Info>
                    Call concentration is the strike above the index with the
                    most calls open; put concentration is the strike below it
                    with the most puts. The displayed window pools expiries and
                    may be dominated by different dates. These are open
                    positions, not support or resistance. Inspect one expiry for
                    a precise view.
                  </Info>
                </span>
                <div>
                  <span>
                    Puts <b>{lv?.put_wall ? `$${price(lv.put_wall)}` : "—"}</b>
                  </span>
                  <span>
                    Calls{" "}
                    <b>{lv?.call_wall ? `$${price(lv.call_wall)}` : "—"}</b>
                  </span>
                  <span>
                    Put / call OI{" "}
                    <Info>
                      Put contracts divided by call contracts across all live
                      expiries. This does not identify buyers or sellers.
                    </Info>
                    <b>{o.pc_oi_ratio?.toFixed(2) ?? "—"}</b>
                  </span>
                </div>
              </div>
              <footer>
                <span>
                  {historical ? "Historical snapshot" : "Quoted"} · {utc(o.ts)}
                </span>
                <span>Inspect expiries & strikes ↗</span>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
