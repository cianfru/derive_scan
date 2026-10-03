import { useState, useRef, useEffect } from "react";
import { Tabs, Info, Plate } from "./ui.jsx";
import {
  OIWall,
  Smile,
  TermStructure,
  MiniSeries,
  PricedByDate,
  TakerFlow,
} from "./OptionsViz.jsx";
import {
  MoveBand,
  SkewInstrument,
  VolatilityTenors,
} from "./OptionsInstruments.jsx";
import {
  FlowCoverage,
  ModelDetails,
  QUALITY_LABEL,
} from "./AnalyticalDetails.jsx";
import { expiryDate, expiryEvidence } from "../lib/research.js";
import { pct, price, utc } from "../lib/format.js";

function ExpiryDesk({ opts }) {
  const exps = (opts.expiries || [])
    .filter((e) => opts.strikes?.expiries?.[String(e.expiry)])
    .sort((a, b) => a.expiry - b.expiry);
  const initial = exps.reduce(
    (a, b) =>
      !a || Math.abs(b.tenor_days - 30) < Math.abs(a.tenor_days - 30) ? b : a,
    null,
  )?.expiry;
  const [selected, setSelected] = useState(null);
  const key = exps.some((e) => e.expiry === selected) ? selected : initial;
  const { rows, expiry, implied, call, put } = expiryEvidence(opts, key);
  const rail = useRef(null);
  useEffect(() => {
    const node = rail.current;
    const selectedButton = node?.querySelector('[aria-pressed="true"]');
    if (!selectedButton) return;
    const box = node.getBoundingClientRect(),
      button = selectedButton.getBoundingClientRect();
    if (window.matchMedia("(max-width: 600px)").matches)
      node.scrollLeft +=
        button.left - box.left - (box.width - button.width) / 2;
    else
      node.scrollTop += button.top - box.top - (box.height - button.height) / 2;
  }, [key]);
  const index = opts.features?.index_price;
  if (!exps.length)
    return (
      <p className="status">No strike snapshot is available for this market.</p>
    );
  const maxOI = Math.max(
    1,
    ...exps.map((e) => (e.call_oi || 0) + (e.put_oi || 0)),
  );
  return (
    <div className="expiry-workspace">
      <aside ref={rail} className="expiry-rail">
        <div className="expiry-rail-title">
          Expiry{" "}
          <Info>
            Choose one expiry. Open interest, volatility by strike, the forward
            and the model range all refer to this same date. The small rail bar
            compares total contracts across this market's expiries.
          </Info>
        </div>
        {exps.map((e) => (
          <button
            key={e.expiry}
            aria-pressed={e.expiry === key}
            onClick={() => setSelected(e.expiry)}
          >
            <strong>{expiryDate(e.expiry).slice(5)}</strong>
            <span>{e.tenor_days.toFixed(1)} days</span>
            <i aria-hidden="true">
              <b
                style={{
                  width: `${(((e.call_oi || 0) + (e.put_oi || 0)) / maxOI) * 100}%`,
                }}
              />
            </i>
          </button>
        ))}
      </aside>
      <div className="expiry-desk">
        <div className="expiry-desk-heading">
          <div>
            <span className="section-code">EXPIRY STUDY</span>
            <h3>
              {expiryDate(key)}{" "}
              <span>{expiry?.tenor_days.toFixed(1)} days</span>
            </h3>
          </div>
          <span className="status">
            {expiry?.n_options ?? rows.length * 2} instruments
          </span>
        </div>
        <div className="expiry-metrics">
          <div>
            <span>
              ATM volatility{" "}
              <Info>
                Annualised at-the-money implied volatility for this selected
                expiry, from the recorded surface.
              </Info>
            </span>
            <b>{pct(expiry?.atm_iv)}</b>
          </div>
          <div>
            <span>
              Forward{" "}
              <Info>
                The forward value from the option snapshot for this expiry. It
                differs from spot through carry and market pricing.
              </Info>
            </span>
            <b>${price(expiry?.forward)}</b>
          </div>
          <div>
            <span>
              Largest put position{" "}
              <Info>
                The strike with the most open puts in this expiry, across all
                strikes. Position size is a count of contracts and does not tell
                us who bought or sold.
              </Info>
            </span>
            <b>{put ? `$${price(put[0])}` : "—"}</b>
            <small>
              {put
                ? `${put[2].toLocaleString(undefined, { maximumFractionDigits: 2 })} contracts`
                : "No put OI"}
            </small>
          </div>
          <div>
            <span>
              Largest call position{" "}
              <Info>
                The strike with the most open calls in this expiry, across all
                strikes. This is an OI concentration, not a resistance level.
              </Info>
            </span>
            <b>{call ? `$${price(call[0])}` : "—"}</b>
            <small>
              {call
                ? `${call[1].toLocaleString(undefined, { maximumFractionDigits: 2 })} contracts`
                : "No call OI"}
            </small>
          </div>
        </div>
        <div className="expiry-charts">
          <section>
            <h4>
              Where the positions sit{" "}
              <Info>
                Open contracts by strike. Put and call bars use the same
                contract scale. The index marker anchors the strike axis. Large
                concentrations show where positions have accumulated; the
                snapshot does not reveal trade intent.
              </Info>
            </h4>
            <OIWall rows={rows} index={index} allStrikes />
          </section>
          <section>
            <h4>
              The cost across strikes{" "}
              <Info>
                Call and put implied volatility for the selected expiry. A
                higher left wing means downside protection is priced richer at
                those strikes. Only available quotes are shown.
              </Info>
            </h4>
            <Smile rows={rows} index={index} />
            <div className="selected-range">
              <span className="label">
                Range priced for this expiry{" "}
                <Info>
                  The middle half of the option-implied model distribution,
                  between its 25th and 75th percentiles. ATM fallback uses one
                  volatility and omits strike skew. This describes a pricing
                  model, not a forecast interval.
                </Info>
              </span>
              <strong>
                {implied
                  ? `$${price(implied.q[1])} — $${price(implied.q[3])}`
                  : "Unavailable"}
              </strong>
              <span>
                {implied
                  ? implied.method === "atm"
                    ? "ATM fallback · strike skew excluded"
                    : "Checked smile"
                  : "No usable range for this date"}
              </span>
            </div>
          </section>
        </div>
        <ModelDetails implied={implied ? [implied] : []} />
        <p className="status">
          Strike snapshot {utc(opts.chain_at)} ·{" "}
          {QUALITY_LABEL[opts.chain_status] || "Unavailable"}
        </p>
      </div>
    </div>
  );
}
export default function OptionsWorkspace({ opts, und, flow, embedded = false }) {
  const [view, setView] = useState("expiry");
  const [window, setWindow] = useState("24h");
  const f = opts.features || {},
    hist = opts.iv_history || [];
  const historical =
    opts.status !== "ready" || Date.now() / 1000 - opts.ts > 1800;
  return (
    <section id="options-detail" className="options-workspace">
      {embedded ? <p className="status">{historical ? "Historical pricing" : "Option snapshot"} · {utc(opts.ts)}</p> : (
      <div className="section-heading">
        <div>
          <span className="section-code">02 / OPTIONS MARKET</span>
          <h2>{und} — the price of risk</h2>
          <p className="sub">
            Movement, protection and positioning. Inspect one expiry at a time.
          </p>
        </div>
        <div className="close-stamp">
          <span>{historical ? "Historical pricing" : "Option snapshot"}</span>
          <b>{utc(opts.ts)}</b>
        </div>
      </div>)}
      <div className="options-dashboard">
        <MoveBand index={f.index_price} iv={f.atm_iv_30d} />
        <SkewInstrument rr={f.rr25_30d} />
        <VolatilityTenors features={f} />
      </div>
      <div className="options-desk">
        <div className="desk-tabs">
          <Tabs
            label="Options research view"
            value={view}
            onChange={setView}
            items={[
              ["expiry", "Expiry & strikes"],
              ["ranges", "Priced ranges"],
              ["flow", "Trade flow"],
              ["history", "Volatility history"],
            ]}
          />
        </div>
        {view === "expiry" && <ExpiryDesk opts={opts} />}
        {view === "ranges" && (
          <div className="desk-panels">
            <Plate
              title="Priced ranges by expiry"
              info="Thick bands contain the middle half of model outcomes; thin bands contain eight in ten. The centre mark is the model median. Each band belongs to its own expiry and pricing method."
            >
              <PricedByDate implied={opts.implied} index={f.index_price} />
              <ModelDetails implied={opts.implied} />
            </Plate>
            <Plate
              title="Volatility term structure"
              info="Annualised ATM volatility by days to expiry. Near expiries above longer ones indicate a higher near-term price of movement, independently of direction."
            >
              <TermStructure expiries={opts.expiries} />
            </Plate>
          </div>
        )}
        {view === "flow" && (
          <div className="desk-panels">
            <Plate
              title="Aggressive option activity"
              info="Takers crossed the spread. Calls bought and puts sold add to the upward premium category; puts bought and calls sold add to the defensive category. Hedges and income selling are mixed in."
              right={
                <Tabs
                  label="Flow collection window"
                  value={window}
                  onChange={setWindow}
                  items={[
                    ["24h", "24 hours"],
                    ["7d", "7 days"],
                  ]}
                />
              }
            >
              <FlowCoverage coverage={flow?.[window]?.coverage} />
              <TakerFlow flow={flow?.[window]} />
            </Plate>
            <div className="flow-method">
              <span className="section-code">COLLECTION STATUS</span>
              <h3>
                {opts.lean?.status === "ready"
                  ? "Options tone available"
                  : "Options tone is still collecting"}
              </h3>
              <p>
                The combined tone needs both 30-day skew and a fully collected
                seven-day premium window.
              </p>
              <FlowCoverage coverage={opts.lean?.flow_coverage} />
              <p>
                Partial activity remains visible here. It contributes no
                directional tone until coverage is complete.
              </p>
            </div>
          </div>
        )}
        {view === "history" && (
          <div className="desk-panels">
            <Plate
              title="30-day ATM volatility"
              info="Recorded annualised 30-day at-the-money volatility. This is option-pricing history, independent of the underlying coin's candle history."
            >
              <MiniSeries points={hist.map((h) => [h[0], h[2]])} />
            </Plate>
            <Plate
              title="30-day skew"
              info="Call minus put IV at 25 delta over recorded observations, in volatility points."
            >
              <MiniSeries
                points={hist.map((h) => [h[0], h[4]])}
                zero
                color="var(--up)"
                format={(v) => (v * 100).toFixed(1)}
              />
            </Plate>
            <p className="status">
              {hist.length
                ? `${hist.length} recorded samples · ${utc(hist[0][0])} to ${utc(hist.at(-1)[0])}`
                : "History is still being collected."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
