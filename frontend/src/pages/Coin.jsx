import { useEffect } from "react";
import {
  Link,
  useOutletContext,
  useParams,
  useLocation,
} from "react-router-dom";
import { useData } from "../lib/data.js";
import {
  price,
  chg,
  pct,
  usd,
  title,
  utc,
  REGIME,
  DATA_LABEL,
} from "../lib/format.js";
import { Signal, Plate, Loading, Failed, Info } from "../components/ui.jsx";
import CandleChart from "../components/CandleChart.jsx";
import AlignmentGrid, { ALIGN_INFO } from "../components/Alignment.jsx";

import { Asset, Reading } from "../components/MarketVisuals.jsx";
import EngineComparison, {
  EngineEvidence,
} from "../components/EngineComparison.jsx";
import OptionsWorkspace from "../components/OptionsWorkspace.jsx";
import MetricHistory from "../components/MetricHistory.jsx";
import { currentEngine } from "../lib/research.js";
import { SIGNAL_HELP, REGIME_HELP } from "../lib/explain.js";
import { QUALITY_LABEL } from "../components/AnalyticalDetails.jsx";

function Readout({ row, alignment }) {
  if (!row) return <p className="status">No signal yet.</p>;
  const z = Math.max(-3, Math.min(3, row.zscore || 0));
  return (
    <div className="figs">
      <div className="fig">
        <span>Signal</span>
        {alignment ? (
          <Reading alignment={alignment} kind="engine" />
        ) : row.signal_status === "ready" && row.data_status === "ready" ? (
          <Signal s={row.signal} />
        ) : (
          <strong style={{ fontSize: 13 }}>Unavailable</strong>
        )}
      </div>
      <div className="fig">
        <span>
          Daily regime{" "}
          <Info label="Explain this regime">{REGIME_HELP[row.regime]}</Info>
        </span>
        <strong style={{ fontSize: 15 }}>
          {REGIME[row.regime] || title(row.regime)}
        </strong>
      </div>
      <div className="fig">
        <span>
          Z-score{" "}
          <Info>
            How far price sits from its trend, in standard deviations. Above 2.5
            is stretched.
          </Info>
        </span>
        <span className="meter" style={{ textTransform: "none" }}>
          <i className="center">
            <b
              style={{
                left: `${50 + (Math.min(0, z) / 3) * 50}%`,
                width: `${(Math.abs(z) / 3) * 50}%`,
                background: "var(--sig-strong)",
              }}
            />
          </i>
          <strong style={{ fontSize: 15 }}>
            {row.zscore?.toFixed(2) ?? "-"}
          </strong>
        </span>
      </div>
      <div className="fig">
        <span>
          Heat{" "}
          <Info>
            Distance from the long-term base, 0 to 100. High heat means
            extended.
          </Info>
        </span>
        <span className="meter" style={{ textTransform: "none" }}>
          <i>
            <b style={{ left: 0, width: `${Math.min(100, row.heat || 0)}%` }} />
          </i>
          <strong style={{ fontSize: 15 }}>{row.heat ?? "-"}</strong>
        </span>
      </div>
      <div className="fig">
        <span>
          Exhaustion{" "}
          <Info>
            Examines stretch, relative volume and signs of selling absorption or
            a climax. It is one input to the engine, not a standalone reversal
            call.
          </Info>
        </span>
        <strong style={{ fontSize: 15 }}>{title(row.exhaustion_state)}</strong>
      </div>
      <div className="fig">
        <span>
          Ribbon{" "}
          <Info>
            Trend structure from four moving averages. Gold: stacked up. Blue:
            stacked down. Grey: no clear order.
          </Info>
        </span>
        <strong
          style={{
            fontSize: 15,
            color:
              row.ribbon?.state === "gold"
                ? "var(--orange)"
                : row.ribbon?.state === "blue"
                  ? "var(--sig-exit)"
                  : "var(--muted)",
          }}
        >
          {title(row.ribbon?.state)}
        </strong>
      </div>
      <div className="fig">
        <span>
          Conditions{" "}
          <Info>
            Passed checks out of all checks. Unknown evidence earns no point.
            Inspect each result and its source under Why this signal.
          </Info>
        </span>
        <strong style={{ fontSize: 15 }}>
          {row.conditions_met ?? "-"} / {row.conditions_total ?? "-"}
        </strong>
      </div>
      <div className="fig">
        <span>
          Data quality{" "}
          <Info>
            Ready requires sufficient price history and completed engine
            calculations. Daily volume availability is checked separately.
            Expand Daily price history below the chart for counts and sources.
          </Info>
        </span>
        <strong
          style={{
            fontSize: 13,
            color: row.data_status === "ready" ? "var(--fg)" : "var(--sig-acc)",
          }}
        >
          {DATA_LABEL[row.data_status] || "-"}
        </strong>
      </div>
    </div>
  );
}

const HORIZON_DAYS = { "4h": 21, "1d": 120 };
const LEAN = {
  defensive: ["Defensive tone", "down"],
  neutral: ["Balanced tone", ""],
  up: ["Upward tone", "up"],
};

function Lean({ lean }) {
  const [label, cls] = (lean?.version === 2 && LEAN[lean.state]) || [
    QUALITY_LABEL[lean?.status] || "Unavailable",
    "faint",
  ];
  return (
    <strong className={cls} style={{ fontSize: 15 }}>
      {label}
    </strong>
  );
}

function ChartLegend({ opts, tf, last }) {
  const cone = (opts?.implied || []).filter((e) => e.days <= HORIZON_DAYS[tf]);
  const lv = opts?.levels;
  if (!cone.length && !lv) return null;
  const end = cone[cone.length - 1];
  const base = opts?.features?.index_price;
  const rel = (v) =>
    base ? `${v >= base ? "+" : ""}${((v / base - 1) * 100).toFixed(1)}%` : "-";
  return (
    <div className="chart-legend">
      {end && (
        <>
          <span>
            Priced range to{" "}
            {new Date(end.expiry * 1000).toISOString().slice(5, 10)}
          </span>
          <span>
            <i style={{ background: "var(--up)" }} />
            <b className="up">{rel(end.q[3])}</b>
          </span>
          <span>
            <i style={{ background: "var(--down)" }} />
            <b className="down">{rel(end.q[1])}</b>
          </span>
          <span className="dim">
            {end.method === "atm" ? "ATM fallback" : "Checked smile"} ·{" "}
            {utc(opts.ts)}
          </span>
          <Info>
            The upper and lower edges bound the middle half of the model
            distribution for each expiry; the dashed line is its median. They
            begin at the option snapshot's index and time. Asymmetry can reflect
            the forward, volatility and skew, so it does not by itself identify
            call buying. ATM fallback omits strike skew. These are
            market-pricing model ranges.
          </Info>
        </>
      )}
      {lv && (
        <>
          <span>
            <i className="dots" style={{ color: "var(--up)" }} />
            Call wall {lv.call_wall?.toLocaleString() ?? "-"}
          </span>
          <span>
            <i className="dots" style={{ color: "var(--down)" }} />
            Put wall {lv.put_wall?.toLocaleString() ?? "-"}
          </span>
          <span>
            <i className="dots" style={{ color: "var(--muted)" }} />
            Min payout {lv.max_pain?.toLocaleString() ?? "-"} ·{" "}
            {lv.max_pain_expiry
              ? new Date(lv.max_pain_expiry * 1000).toISOString().slice(5, 10)
              : "-"}
          </span>
          <Info>
            Open interest on expiries in the next {lv.days} days. Call wall: the
            strike above the index with the most calls open; put wall: the
            strike below with the most puts. Minimum payout: the price with the
            smallest total intrinsic payout at the single displayed expiry.
            Walls pool the shown window; payout minima are calculated separately
            per expiry. These are OI concentrations, not support or resistance.
          </Info>
        </>
      )}
    </div>
  );
}

export default function Coin() {
  const { und } = useParams();
  const { theme } = useOutletContext();
  const { data, error } = useData(`coins/${und}.json`);
  const tf = "1d";
  const { hash } = useLocation();
  useEffect(() => {
    if (!data || !hash) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, !!data]);
  if (error && !data)
    return (
      <div className="wrap page">
        <Failed error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="wrap page">
        <Loading />
      </div>
    );
  const candles = data.candles[tf] || [];
  const last = candles[candles.length - 1];
  const prevDay = candles[candles.length - 2];
  const dayChg = last && prevDay ? (last[4] / prevDay[4] - 1) * 100 : null;
  const row = data.latest?.[tf];
  const pos = data.latest?.["1d"]?.positioning;
  return (
    <div className="wrap page coin-page">
      <div
        className="coin-heading"
        style={{
          display: "flex",
          alignItems: "end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Link to="/markets" className="status">
            Markets /
          </Link>
          <h1
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <Asset und={und} />
            <span className="mono" style={{ fontSize: 24, fontWeight: 500 }}>
              {price(last?.[4])}
            </span>
            <span
              className={`mono ${dayChg > 0 ? "up" : dayChg < 0 ? "down" : ""}`}
              style={{ fontSize: 15 }}
            >
              {chg(dayChg)} 1D
            </span>
          </h1>
          <p className="status" style={{ margin: "6px 0 0" }}>
            Last daily close in USD. Change compares the two latest completed
            UTC days.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 22,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span className="label">
            Daily engine{" "}
            {data.alignment ? (
              <Reading alignment={data.alignment} kind="engine" />
            ) : (
              <Signal
                s={
                  row?.signal_status === "ready" && row?.data_status === "ready"
                    ? row.signal
                    : null
                }
              />
            )}
          </span>
          {data.options && (
            <span className="label">
              Options <Lean lean={data.options.lean} />
            </span>
          )}
        </div>
      </div>
      <nav className="section-nav" aria-label="Market sections">
        {data.alignment && <a href="#alignment">Three perspectives</a>}
        <a href="#price-chart">Price chart</a>
        <a href="#metric-history">History</a>
        <a href="#engine-comparison">Engine comparison</a>
        {data.options && <a href="#options-detail">Options detail</a>}
      </nav>
      <div id="engine-comparison" className="engine-evidence-workspace">
        <EngineComparison comparison={data.engine_comparison} />
        <EngineEvidence latest={data.latest} />
      </div>
      <MetricHistory key={und} history={data.history} />
      <Plate
        className="price-stage"
        id="price-chart"
        title={`${und} / Daily price & options ranges`}
        info={
          <>
            Derive's index price with traded volume. Orange line: fast average;
            grey: slow. Markers show where the signal changed.{" "}
            {data.backfilled?.[tf]
              ? `${data.backfilled[tf]} earlier bars are stored from external spot markets. The chart shows the latest available 400 daily bars; external volume is never used.`
              : ""}
          </>
        }
        right={
          <span className="status">
            {row?.signal_bar_close_time
              ? `Bar closed ${utc(row.signal_bar_close_time)}`
              : ""}
          </span>
        }
      >
        <CandleChart
          candles={candles}
          signals={data.signals?.[tf]}
          tf={tf}
          theme={theme}
          implied={data.options?.implied}
          levels={data.options?.levels}
          optionsAt={data.options?.ts}
          optionsIndex={data.options?.features?.index_price}
        />
        <ChartLegend opts={data.options} tf={tf} last={last?.[4]} />
        <details className="history-explanation">
          <summary>
            Daily price history ·{" "}
            {data.daily_history?.available_bars ?? candles.length} stored bars
            {data.daily_history?.refresh_pending
              ? " / reading update pending"
              : ""}
          </summary>
          <p>
            The engine needs 200 bars to begin regime calculations and 499 for
            full normalisation.{" "}
            {data.daily_history?.evaluated_bars ?? "Unknown"} bars were
            evaluated at the displayed close.{" "}
            {data.daily_history?.price_only_bars || 0} earlier price-only bars
            come from{" "}
            {data.daily_history?.sources?.join(", ") || "external spot markets"}
            ; volume remains Derive-only.{" "}
            {data.daily_history?.refresh_pending
              ? "Additional history has been recovered since that reading. It enters the engine on the next daily close; the old signal is not reissued as a new event."
              : "Newly listed tokens may still have less history than the engine requires."}
          </p>
        </details>
      </Plate>
      {currentEngine(data.engine_comparison?.["1d"]) && (
        <Readout row={row} alignment={data.alignment} />
      )}
      {data.alignment && (
        <Plate id="alignment" title="Three perspectives" info={ALIGN_INFO}>
          <AlignmentGrid alignment={data.alignment} />
        </Plate>
      )}
      {pos && (
        <div className="figs">
          <div className="fig">
            <span>
              Funding, annual{" "}
              <Info>
                The observed hourly perpetual funding rate multiplied by 24 ×
                365. This is an annualised snapshot, not a fixed yield.
              </Info>
            </span>
            <strong className={pos.funding_rate < 0 ? "down" : ""}>
              {pct(
                pos.funding_rate == null ? null : pos.funding_rate * 24 * 365,
              )}
            </strong>
          </div>
          <div className="fig">
            <span>
              Funding regime{" "}
              <Info>
                Describes the current perpetual funding conditions. Positive
                funding generally means longs pay shorts; it does not identify a
                future price direction.
              </Info>
            </span>
            <strong style={{ fontSize: 14 }}>
              {title(pos.funding_regime?.replace("_", " "))}
            </strong>
          </div>
          <div className="fig">
            <span>
              Perp open interest{" "}
              <Info>
                Outstanding perpetual contracts marked in dollars at the ticker
                observation.
              </Info>
            </span>
            <strong>{usd(pos.oi_value)}</strong>
          </div>
          <div className="fig">
            <span>
              OI contract change{" "}
              <Info>
                Contract count and mark-price changes use the same two ticker
                observations. Dollar OI also moves with price. These
                measurements do not identify which side opened contracts or
                establish liquidations.
              </Info>
            </span>
            <strong style={{ fontSize: 14 }}>
              {pos.oi_status === "ready"
                ? chg(pos.oi_change_pct)
                : "Unavailable"}
            </strong>
            <small className="dim">
              {pos.oi_status === "ready"
                ? `Price ${chg(pos.price_change_pct)} · ${(pos.interval_seconds / 3600).toFixed(1)}h interval`
                : "Needs two comparable observations"}
            </small>
          </div>
          <div className="fig">
            <span>
              Perp volume 24h{" "}
              <Info>
                Derive-reported perpetual traded notional over the ticker’s last
                24 hours.
              </Info>
            </span>
            <strong>{usd(pos.volume_24h)}</strong>
          </div>
        </div>
      )}
      {data.latest?.[tf]?.signal_reason && (
        <Plate
          id="signal-evidence"
          title="Why this signal"
          info="The engine's own summary of the conditions it checked on the last closed bar."
        >
          <p className="signal-explanation">
            {row?.data_status === "ready"
              ? SIGNAL_HELP[row.signal]
              : "The daily reading is withheld until its history and quality checks pass. Expand the history note for the available sample and source."}
          </p>
          <details className="condition-details">
            <summary>Engine diagnostic text</summary>
            <p className="status">{data.latest[tf].signal_reason}</p>
          </details>
        </Plate>
      )}
      {data.options ? (
        <OptionsWorkspace
          key={und}
          opts={data.options}
          und={und}
          flow={data.taker_flow}
        />
      ) : (
        <p className="status">{und} has no options on Derive.</p>
      )}
    </div>
  );
}
