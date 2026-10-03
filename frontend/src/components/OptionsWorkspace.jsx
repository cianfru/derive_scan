import { useState, useRef, useEffect, useMemo } from "react";
import { Tabs, Info, Plate, PanelHead } from "./ui.jsx";
import HistoryStrip from "./HistoryStrip.jsx";
import SurfaceHistory from "./SurfaceHistory.jsx";
import { useData } from "../lib/data.js";
import { FORMAT, dashboardStrips, decodeSurface } from "../lib/surface.js";
import { OIWall, Smile, TermStructure, MiniSeries, PricedByDate, TakerFlow } from "./OptionsViz.jsx";
import { MoveBand, SkewInstrument, VolatilityTenors } from "./OptionsInstruments.jsx";
import { expiryDate, expiryEvidence } from "../lib/research.js";
import { pct, price, strike, utc, DASH } from "../lib/format.js";

const contracts = (v) => `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} contracts`;

function ExpiryDesk({ opts }) {
  const exps = (opts.expiries || [])
    .filter((e) => opts.strikes?.expiries?.[String(e.expiry)])
    .sort((a, b) => a.expiry - b.expiry);
  const initial = exps.reduce(
    (a, b) => (!a || Math.abs(b.tenor_days - 30) < Math.abs(a.tenor_days - 30) ? b : a),
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
      node.scrollLeft += button.left - box.left - (box.width - button.width) / 2;
    else node.scrollTop += button.top - box.top - (box.height - button.height) / 2;
  }, [key]);
  const index = opts.features?.index_price;
  if (!exps.length) return <p className="status desk-empty">No strikes for this market yet.</p>;
  return (
    <div className="expiry-workspace">
      <aside ref={rail} className="expiry-rail" aria-label="Expiries">
        {exps.map((e) => (
          <button key={e.expiry} aria-pressed={e.expiry === key} onClick={() => setSelected(e.expiry)}>
            <strong>{expiryDate(e.expiry).slice(5)}</strong>
            <span>{Math.round(e.tenor_days) || "<1"}d</span>
          </button>
        ))}
      </aside>
      <div className="expiry-desk">
        <div className="expiry-desk-heading">
          <h3>
            {expiryDate(key)} <span>{expiry?.tenor_days.toFixed(1)} days</span>
          </h3>
          <Info label="About this expiry">
            Everything here refers to the selected expiry. ATM volatility: annualised at-the-money implied
            volatility. Forward: the expiry's forward price, which differs from the index through carry. Largest
            put and call: the strikes with the most open contracts; open interest does not show who bought or sold,
            and a concentration is not support or resistance.
          </Info>
        </div>
        <div className="expiry-metrics">
          <div>
            <span>ATM volatility</span>
            <b>{pct(expiry?.atm_iv)}</b>
          </div>
          <div>
            <span>Forward</span>
            <b>{Number.isFinite(expiry?.forward) ? `$${price(expiry.forward)}` : DASH}</b>
          </div>
          <div>
            <span>Largest put</span>
            <b>{put ? strike(put[0]) : DASH}</b>
            {put && <small>{contracts(put[2])}</small>}
          </div>
          <div>
            <span>Largest call</span>
            <b>{call ? strike(call[0]) : DASH}</b>
            {call && <small>{contracts(call[1])}</small>}
          </div>
        </div>
        <div className="expiry-charts">
          <section>
            <PanelHead as="h4" title="Open interest by strike"
              info="Open contracts by strike, puts left and calls right on one contract scale. The dashed line is the index. Large concentrations show where positions sit; the snapshot does not reveal trade intent." />
            <OIWall rows={rows} index={index} allStrikes />
          </section>
          <section>
            <PanelHead as="h4" title="Volatility by strike"
              info="Implied volatility across strikes for this expiry: puts below the index, calls above. A higher left wing means downside protection is priced richer. Only quoted strikes are drawn." />
            <Smile rows={rows} index={index} />
            <div className="selected-range">
              <span className="label">
                Priced range
                <Info label="About the priced range">
                  The middle half of outcomes option prices imply for this expiry, between the 25th and 75th
                  percentiles of the pricing model.
                  {implied?.method === "atm" ? " This expiry uses a single at-the-money volatility, so strike skew is left out." : " The model uses the checked volatility smile."}
                  {" "}It describes market pricing, not our view. Strike snapshot {utc(opts.chain_at)}.
                </Info>
              </span>
              <strong className="mono">{implied ? `$${price(implied.q[1])} — $${price(implied.q[3])}` : DASH}</strong>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The (i) text of each dashboard cell; "surface": with rebuilt daily history, "snapshots": recorded
 * 15-minute quotes only, null: no history line shown. */
export function cellInfo(kind, mode) {
  const line = {
    move: {
      surface: " Line: each day's reading rebuilt from the options traded on Derive that day (thin, 5-day median), then the daily median of quotes recorded every 15 minutes since 1 Oct 2026 (thick). Dot: the latest snapshot. Band: the middle 80% of the past year. Rank (pct): where the latest rebuilt reading sits within that year, or within the whole history when it is shorter.",
      snapshots: " Line: quotes recorded every 15 minutes over the past 14 days.",
    },
    skew: {
      surface: " Area: above zero calls are priced richer, below zero puts. Thin line: rebuilt from traded options; thick line: recorded quotes since 1 Oct 2026; dot: the latest snapshot. Rank (pct): where the latest rebuilt reading sits within the past year, or within the whole history when it is shorter.",
      snapshots: " Line: quotes recorded every 15 minutes over the past 14 days.",
    },
    term: {
      surface: " Line: 7-day minus 30-day ATM volatility. Above zero, the coming week is priced higher than the month (an inverted curve). Thin line: rebuilt from traded options; thick line: recorded quotes since 1 Oct 2026; dot: the latest snapshot. Band and rank (pct): the middle 80% of the past year and where the latest rebuilt reading sits within it.",
      snapshots: " Line: 7-day minus 30-day ATM volatility from quotes recorded every 15 minutes over the past 14 days.",
    },
  };
  const base = {
    move: "Index × annualised 30-day ATM implied volatility × √(30/365): the one-standard-deviation size of movement priced into options. Symmetric, ignores strike skew; the centre is the quoted index.",
    skew: "25-delta call IV minus put IV, in volatility points, interpolated to 30 days. Negative: puts priced richer for comparable delta; positive: calls richer. It does not identify trade direction.",
    term: "Annualised ATM implied volatility at 7, 30 and 90 days, interpolated across expiries, on one scale. Longer tenors above shorter ones form an upward curve.",
  };
  return `${base[kind]}${(mode && line[kind][mode]) || ""} Market pricing, not our view.`;
}

/** One dashboard cell: title and (i), the rank label, today's figures, then the history strip. */
function DashCell({ kind, title, strip, className = "", children, ...stripProps }) {
  const mode = strip ? (strip.snapshots ? "snapshots" : "surface") : null;
  return (
    <div className={`dash-cell ${className}`}>
      <PanelHead as="h3" title={title} info={cellInfo(kind, mode)} />
      {strip?.rank && <span className="dash-rank mono">{strip.rank}</span>}
      <div className="dash-figures">{children}</div>
      {strip && <HistoryStrip series={strip} label={`${title} history`} format={FORMAT[kind]} {...stripProps} />}
    </div>
  );
}

export default function OptionsWorkspace({ opts, und, flow, embedded = false, hasSurface = false }) {
  const [view, setView] = useState("expiry");
  const [window, setWindow] = useState("24h");
  const f = opts.features || {},
    hist = opts.iv_history || [];
  const historical = opts.status !== "ready" || Date.now() / 1000 - opts.ts > 1800;
  // Daily history from traded options: a separate file, read only for coins that have one.
  const { data: doc } = useData(hasSurface ? `surface/${und}.json` : null, 30 * 60_000);
  const surface = useMemo(() => decodeSurface(doc), [doc]);
  const strips = useMemo(() => dashboardStrips(surface, opts), [surface, opts]);
  return (
    <section id="options-detail" className={`options-workspace${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <div className="section-heading">
          <h2>{und} options</h2>
          <span className="status mono">{historical ? "Historical · " : ""}{utc(opts.ts)}</span>
        </div>
      )}
      <div className="options-dashboard plate">
        <DashCell kind="move" title="30-day move" strip={strips.move}>
          <MoveBand index={f.index_price} iv={f.atm_iv_30d} bare />
        </DashCell>
        <DashCell kind="skew" title="30-day skew" strip={strips.skew} area>
          <SkewInstrument rr={f.rr25_30d} bare />
        </DashCell>
        <DashCell kind="term" title="Term structure" strip={strips.term} className="term-cell" zero>
          <VolatilityTenors features={f} bare />
        </DashCell>
      </div>
      <div className="options-desk plate">
        <div className="desk-tabs">
          <Tabs
            label="Options view"
            value={view}
            onChange={setView}
            items={[
              ["expiry", "Expiry & strikes", "Strikes"],
              ["ranges", "Priced ranges", "Ranges"],
              ["flow", "Trade flow", "Flow"],
              ["history", "Volatility history", "IV history"],
            ]}
          />
        </div>
        {view === "expiry" && <ExpiryDesk opts={opts} />}
        {view === "ranges" && (
          <div className="desk-panels">
            <Plate
              title="Priced ranges by expiry"
              info="For each expiry, the thick band holds the middle half of the outcomes option prices imply (red below the median, green above) and the thin line eight in ten; the tick is the median. Each band uses its own expiry's pricing. Market pricing, not our view."
            >
              <PricedByDate implied={opts.implied} index={f.index_price} />
            </Plate>
            <Plate
              title="Volatility term structure"
              info="Annualised ATM volatility by days to expiry. Near expiries above longer ones mean movement is priced higher in the short term, whatever the direction."
            >
              <TermStructure expiries={opts.expiries} />
            </Plate>
          </div>
        )}
        {view === "flow" && (
          <div className="desk-panels single">
            <Plate
              title="Taker flow"
              info="Trades where the taker crossed the spread, by notional: bought at full strength, sold faded. Hedges and income selling are mixed in. Windows count complete 15-minute buckets; a partial window is context only."
              right={
                <Tabs label="Flow window" value={window} onChange={setWindow} items={[["24h", "24H"], ["7d", "7D"]]} />
              }
            >
              <TakerFlow flow={flow?.[window]} />
            </Plate>
          </div>
        )}
        {view === "history" && (surface ? (
          <div className="desk-panels single">
            <SurfaceHistory surface={surface} opts={opts} />
          </div>
        ) : (
          <div className="desk-panels">
            <Plate title="30-day ATM volatility" info="Recorded annualised 30-day at-the-money implied volatility.">
              <MiniSeries points={hist.map((h) => [h[0], h[2]])} />
            </Plate>
            <Plate title="30-day skew" info="25-delta call minus put implied volatility over the recorded snapshots, in volatility points.">
              <MiniSeries points={hist.map((h) => [h[0], h[4]])} zero format={(v) => (v * 100).toFixed(1)} />
            </Plate>
          </div>
        ))}
      </div>
    </section>
  );
}
