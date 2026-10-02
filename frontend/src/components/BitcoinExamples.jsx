import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, usd, utc } from "../lib/format.js";
import { Asset, Reading } from "./MarketVisuals.jsx";
import { EnginePair, Convergence } from "./EngineComparison.jsx";
import { MoveBand, SkewInstrument } from "./OptionsInstruments.jsx";
import { Info, Loading, Failed } from "./ui.jsx";

export default function BitcoinExamples({ onSelect }) {
  const { data, error } = useData("coins/BTC.json");
  if (!data)
    return (
      <div className="example-loading">
        {error ? <Failed error={error} /> : <Loading />}
      </div>
    );
  const opts = data.options,
    f = opts?.features || {};
  const w = data.alignment?.horizons?.["30d"]?.wallets;
  const quoted =
    w &&
    Number.isFinite(w.net_delta_usd) &&
    Number.isFinite(w.gross_delta_usd) &&
    Number.isFinite(w.score) &&
    w.gross_complete === true;
  return (
    <section
      className="wrap bitcoin-examples"
      aria-label="Bitcoin research examples"
    >
      <div className="section-heading">
        <div>
          <span className="section-code">ONE MARKET / THREE PERSPECTIVES</span>
          <h2>See the evidence on Bitcoin.</h2>
        </div>
        <div className="example-asset">
          <Asset und="BTC" />
          <strong>${price(f.index_price)}</strong>
          <small>Snapshot {utc(opts?.ts || data.generated_at)}</small>
        </div>
      </div>
      <div className="example-grid">
        <article
          className="research-example"
          onMouseEnter={() => onSelect("price")}
          onFocus={() => onSelect("price")}
        >
          <div className="example-heading">
            <span>01</span>
            <h3>Price engine</h3>
          </div>
          <p className="example-purpose">
            The daily setup, with its 4H context.
          </p>
          <EnginePair comparison={data.engine_comparison} compact />
          <Convergence comparison={data.engine_comparison} compact />
          <Link className="example-link" to="/coin/BTC#engine-comparison">
            Inspect the engine <span>↗</span>
          </Link>
        </article>
        <article
          className="research-example"
          onMouseEnter={() => onSelect("options")}
          onFocus={() => onSelect("options")}
        >
          <div className="example-heading">
            <span>02</span>
            <h3>Options market</h3>
          </div>
          <p className="example-purpose">How much movement is priced in?</p>
          <MoveBand index={f.index_price} iv={f.atm_iv_30d} compact />
          <SkewInstrument rr={f.rr25_30d} />
          <Link className="example-link" to="/coin/BTC#options-detail">
            Inspect the surface <span>↗</span>
          </Link>
        </article>
        <article
          className="research-example"
          onMouseEnter={() => onSelect("wallets")}
          onFocus={() => onSelect("wallets")}
        >
          <div className="example-heading">
            <span>03</span>
            <h3>Trader positioning</h3>
          </div>
          <p className="example-purpose">
            The Smart cohort’s BTC options book.
          </p>
          <div className="wallet-example-reading">
            <span className="label">
              Expiries within 30 days{" "}
              <Info>
                The existing Smart cohort, selected by recorded historical
                results. Net delta adds signed option exposure; gross adds
                absolute exposure before netting. This describes the options
                book, not a trader's full portfolio or intent.
              </Info>
            </span>
            <Reading alignment={data.alignment} horizon="30d" kind="wallets" />
          </div>
          {quoted ? (
            <>
              <div
                className="wallet-balance"
                aria-label={`Snapshot net to gross delta balance: ${(w.score * 100).toFixed(1)}%`}
              >
                <span>Short delta</span>
                <i>
                  <b
                    style={{
                      left: `${50 + Math.max(-1, Math.min(1, w.score || 0)) * 46}%`,
                    }}
                  />
                </i>
                <span>Long delta</span>
              </div>
              <div className="wallet-example-values">
                <div>
                  <span>Net dollar delta</span>
                  <strong className={w.net_delta_usd < 0 ? "down" : "up"}>
                    {usd(w.net_delta_usd)}
                  </strong>
                </div>
                <div>
                  <span>Gross dollar delta</span>
                  <strong>{usd(w.gross_delta_usd)}</strong>
                </div>
              </div>
              <p className="status">
                {w.positions} positions · valued {utc(w.valuation_at)}
                <br />
                History through{" "}
                {data.alignment?.positions_through || "unavailable"}
              </p>
            </>
          ) : (
            <p className="status">
              Position history or usable quote deltas are still being collected.
            </p>
          )}
          <Link className="example-link" to="/radar?focus=BTC">
            Inspect the positioning <span>↗</span>
          </Link>
        </article>
      </div>
    </section>
  );
}
