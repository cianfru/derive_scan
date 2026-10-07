import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { DASH, price, chg, pct, usd, z, dayTime, clock, utc, SIGNAL_RANK, SIGNAL_LABEL, REGIME } from "../lib/format.js";
import { REGIME_LINE } from "../lib/regime.js";
import { QUESTIONS_ON } from "../lib/flags.js";
import { viewReading } from "../lib/presentation.js";
import { Tabs, Loading, Failed, Empty, RefreshNotice, Arrow } from "../components/ui.jsx";
import { marketsLead } from "../lib/takeaway.js";
import { Asset, MarketTrace } from "../components/MarketVisuals.jsx";
import { EnginePair, Convergence, CONVERGENCE_HELP } from "../components/EngineComparison.jsx";
import { currentEngine } from "../lib/research.js";
import StructureBand, { isSignal } from "../components/StructureBand.jsx";
import { LAYERS, LayerIcon, LayerTile, chainAgreed, chainReadings } from "../components/Chain.jsx";
import "../markets.css";

const SCOPE = { options: "options markets", entries: "daily entries", perps: "perps only" };
const inView = (c, view) => (view === "perps" ? !c.has_options : c.has_options) && (view !== "entries" || (SIGNAL_RANK[c.signal_1d] ?? 0) >= 3);
/** The markets a view holds that have a current daily engine: what the band counts, before search and the signal filter. */
const scopeOf = (coins, view) => (coins || []).filter((c) => inView(c, view) && currentEngine(c.engine_comparison?.["1d"]));

// How far the wallets and options layers agree with the engine for one window (engine first).
function agreement(c, horizon) {
  const states = chainReadings(c.align, horizon).map((x) => x.state);
  const dir = states[0];
  if (!dir || dir === "neutral") return null;
  return states.slice(1).reduce((n, s) => n + (s === dir ? 1 : s && s !== "neutral" ? -1 : 0), 0);
}

const BOARD_HELP = "Each market is read in three steps, always in this order: 1 Regime (the engine: on 4-hour bars for the next 7 days, about 28 bars, and on daily bars for the next 30 days, about 30 bars), 2 Wallets (what Derive's best options traders hold on expiries in the window), 3 Options (what option prices lean towards). Each market has one line for the next 7 days and one for the next 30; “All agree” in orange means the three layers point the same way for that window: context side by side, not a combined signal. The trace is the last 30 daily closes. Hover any reading for what it reads; open a market for the figures behind each one. Price is the latest options index where available; the daily change compares the two latest completed UTC days.";

const WINDOWS = [["7d", "7 days", "4H"], ["30d", "30 days", "1D"]];
const SORTS = [["a7", "Agreement, 7 days"], ["a30", "Agreement, 30 days"], ["und", "Market name"], ["chg_1d", "Daily change"],
  ["z_1d", "Daily stretch"], ["heat_1d", "Daily heat"], ["oi_usd", "Perp open interest"], ["funding_ann", "Funding"]];
const OVERVIEW_SORTS = new Set(["a7", "a30", "und", "chg_1d"]);
const count = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US") : null);

/** One reading in the evidence panel: a term and its value, the value in figures. */
function Fact({ term, num = false, children }) {
  return <div><dt>{term}</dt><dd className={num ? "num" : undefined}>{children ?? <Empty />}</dd></div>;
}

/** What each of a market's readings rests on, for both windows: opened from the row. */
function Evidence({ c, id }) {
  const r = (h, kind) => viewReading(c.align, h, kind);
  const e7 = r("7d", "engine"), e30 = r("30d", "engine");
  const w7 = r("7d", "wallets"), w30 = r("30d", "wallets");
  const o7 = r("7d", "options"), o30 = r("30d", "options");
  const sig = (x) => (x.state ? <>{x.label}{x.row?.regime && <small>{REGIME[x.row.regime]}</small>}</> : <span className="mk-dim">{x.label}</span>);
  const word = (x) => (x.state ? x.label : <span className="mk-dim">{x.label}</span>);
  const regime = e30.state ? e30.row?.regime : null;
  return (
    <div className="mk-evidence" id={id}>
      <div className="mk-evidence-grid">
        <section>
          <span className="mk-ev-label"><LayerIcon kind="engine" size={14} />Regime</span>
          <h3>{regime ? REGIME[regime] : e30.label}</h3>
          <p>{regime ? REGIME_LINE[regime] : e30.why}</p>
          <dl>
            <Fact term="Next 7 days · 4H engine">{sig(e7)}</Fact>
            <Fact term="Next 30 days · 1D engine">{sig(e30)}</Fact>
            <Fact term="Bars read · 4H / 1D" num>{count(e7.row?.history_bars) || count(e30.row?.history_bars) ? `${count(e7.row?.history_bars) ?? DASH} / ${count(e30.row?.history_bars) ?? DASH}` : null}</Fact>
            <Fact term="Daily close read" num>{e30.row?.observed_at ? utc(e30.row.observed_at) : null}</Fact>
          </dl>
        </section>
        <section>
          <span className="mk-ev-label"><LayerIcon kind="wallets" size={14} />Wallets</span>
          <h3>{w30.state || w7.state ? "Smart wallets" : w30.label}</h3>
          <p>{w30.state || w7.state ? "Net delta of Smart wallets' options expiring in each window, valued at recorded marks: how much they gain or lose on a small move in price." : w30.why}</p>
          <dl>
            <Fact term="Next 7 days">{word(w7)}</Fact>
            <Fact term="Net delta · 7 days" num>{w7.row && Number.isFinite(w7.row.net_delta_usd) ? usd(w7.row.net_delta_usd) : null}</Fact>
            <Fact term="Next 30 days">{word(w30)}</Fact>
            <Fact term="Net delta · 30 days" num>{w30.row && Number.isFinite(w30.row.net_delta_usd) ? usd(w30.row.net_delta_usd) : null}</Fact>
            <Fact term="Positions · 7 / 30 days" num>{w7.row || w30.row ? `${count(w7.row?.positions) ?? DASH} / ${count(w30.row?.positions) ?? DASH}` : null}</Fact>
            <Fact term="Valued at" num>{(w30.row || w7.row)?.valuation_at ? utc((w30.row || w7.row).valuation_at) : null}</Fact>
          </dl>
        </section>
        <section>
          <span className="mk-ev-label"><LayerIcon kind="options" size={14} />Options</span>
          <h3>{o30.state || o7.state ? "Option prices" : o30.label}</h3>
          <p>{o30.state || o7.state ? "What option prices lean towards: skew against its own recent range, with the direction of taker flow once recorded flow covers the window." : o30.why}</p>
          <dl>
            <Fact term="Next 7 days">{word(o7)}</Fact>
            <Fact term="Next 30 days">{word(o30)}</Fact>
            <Fact term="Flow covered · 24 h / 7 days" num>{o7.row?.flow_coverage || o30.row?.flow_coverage ? `${pct(o7.row?.flow_coverage?.fraction, 0)} / ${pct(o30.row?.flow_coverage?.fraction, 0)}` : null}</Fact>
            <Fact term="30-day implied volatility" num>{Number.isFinite(c.atm_iv_30d) ? pct(c.atm_iv_30d, 1) : null}</Fact>
            <Fact term="Read at" num>{(o30.row || o7.row)?.observed_at ? utc((o30.row || o7.row).observed_at) : null}</Fact>
          </dl>
        </section>
      </div>
      <div className="mk-evidence-foot">
        <span>Context, not a signal. The three readings are independent.</span>
        <span className="mk-evidence-links">
          {QUESTIONS_ON && c.questions && <Link to={`/saloon?coin=${c.und}`}>{c.und} in the Saloon<Arrow /></Link>}
          <Link to={`/coin/${c.und}`}>Open {c.und}<Arrow /></Link>
        </span>
      </div>
    </div>
  );
}

function MarketRow({ c, open, onToggle }) {
  const id = useId();
  return (
    <article className={`mk-market${open ? " open" : ""}`} aria-label={`${c.und} market`}>
      <div className="mk-row">
        <Link className="mk-coin-link" to={`/coin/${c.und}`} aria-label={`Open ${c.und} chart and data`}>
          <div className="mk-asset">
            <Asset und={c.und} />
            <span className="mk-price">${price(c.price)}<small className={c.chg_1d > 0 ? "up" : c.chg_1d < 0 ? "down" : "dim"}>{chg(c.chg_1d)}</small></span>
          </div>
          <div className="mk-trace">
            <MarketTrace values={c.spark_1d?.slice(-30)} times={c.spark_times_1d?.slice(-30)} label={`${c.und} daily closes`} />
          </div>
        </Link>
        <div className="mk-readings" onClick={(e) => { if (!e.target.closest("button")) onToggle(); }}>
          <div className="mk-windows">
            <div className="mk-mini-head" aria-hidden="true"><span />{LAYERS.map(([kind, name]) => <span key={kind}>{name}</span>)}</div>
            {WINDOWS.map(([h, name, tf]) => {
              const aligned = !!chainAgreed(c.align, h);
              return (
                <div key={h} className={`mk-win${aligned ? " aligned" : ""}`}>
                  <span className="mk-win-label"><b>{name}</b><small>{aligned ? "All agree" : `${tf} engine`}</small></span>
                  {LAYERS.map(([kind]) => <LayerTile key={kind} alignment={c.align} kind={kind} horizon={h} icon={false} aligned={aligned} sub="detail" />)}
                </div>);
            })}
          </div>
          <button className="mk-expand" aria-expanded={open} aria-controls={id} onClick={onToggle}
            aria-label={`${open ? "Hide" : "Show"} what ${c.und}'s readings rest on`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 8h10" />{!open && <path d="M8 3v10" />}</svg>
          </button>
        </div>
      </div>
      {open && <Evidence c={c} id={id} />}
    </article>
  );
}

export default function Markets() {
  const { data, error } = useData("markets.json");
  const [q, setQ] = useState(""),
    [signalFilter, setSignalFilter] = useState(null),
    [view, setView] = useState("options"),
    [details, setDetails] = useState(false),
    [expanded, setExpanded] = useState(null),
    [sort, setSort] = useState(["a7", -1]);
  const scoped = useMemo(() => scopeOf(data?.coins, view), [data, view]);
  const overview = !details && view !== "perps";
  // Agreement only means something on the overview; elsewhere it falls back to the name.
  const sortKey = !overview && (sort[0] === "a7" || sort[0] === "a30") ? ["und", 1] : sort;
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter((c) => inView(c, view) && c.und.toLowerCase().includes(q.trim().toLowerCase()));
    if (signalFilter) r = r.filter((c) => currentEngine(c.engine_comparison?.["1d"]) && isSignal(c, signalFilter));
    const [k, dir] = sortKey;
    const key = (c) => (k === "a7" ? agreement(c, "7d") : k === "a30" ? agreement(c, "30d") : c[k]);
    return [...r].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return (b.align?.score ?? -9) - (a.align?.score ?? -9) || a.und.localeCompare(b.und);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir || (b.align?.score ?? -9) - (a.align?.score ?? -9) || a.und.localeCompare(b.und);
    });
  }, [data, q, view, sortKey[0], sortKey[1], signalFilter]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;

  const sortHead = (key, name, cls = "") => (
    <th className={cls} aria-sort={sortKey[0] === key ? (sortKey[1] > 0 ? "ascending" : "descending") : undefined}>
      <button className="sort-button" onClick={() => setSort(([k, d]) => [key, k === key ? -d : -1])}>
        {name}<span aria-hidden="true">{sortKey[0] === key ? (sortKey[1] > 0 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  // A view change keeps the signal filter only while the new view still holds that signal.
  const changeView = (next) => {
    setView(next);
    setExpanded(null);
    if (signalFilter && !scopeOf(data.coins, next).some((c) => isSignal(c, signalFilter))) setSignalFilter(null);
  };
  const sorts = SORTS.filter(([k]) => (overview ? OVERVIEW_SORTS.has(k) : k !== "a7" && k !== "a30"));
  const lead = marketsLead(data);

  return (
    <div className="wrap page markets-page mk">
      <header className="mk-head">
        <div className="mk-head-text">
          <span className="mk-eyebrow">Markets</span>
          <h1>See the market from three sides.</h1>
          {lead && <div className="mk-lead" role="note" aria-label="Takeaway"><p>{lead.text}</p>{lead.note && <p className="mk-lead-note">{lead.note}</p>}</div>}
        </div>
        <div className="mk-observed">
          <span>Latest daily close</span>
          <b>{data.bars?.["1d"] ? dayTime(data.bars["1d"]) : DASH}</b>
          <small>Snapshot {clock(data.generated_at)}</small>
        </div>
      </header>
      <RefreshNotice error={error} />
      <div className="markets-layout">
        <StructureBand data={data} scoped={scoped} scopeLabel={SCOPE[view]} signalFilter={signalFilter} onSignal={setSignalFilter} />

        <section className="mk-board" aria-label="Market readings">
          <div className="mk-toolbar">
            <Tabs label="Market filter" value={view} onChange={changeView}
              items={[["options", "Options markets", "Options"], ["entries", "Daily entries", "Entries"], ["perps", "Perps only", "Perps"]]} />
            <label className="mk-find">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
              <input placeholder="Find a market" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a market" />
            </label>
          </div>
          <div className="mk-context">
            <span className="mk-count"><b>{rows.length}</b> {SCOPE[view]}{signalFilter ? ` · ${SIGNAL_LABEL[signalFilter] || signalFilter}` : ""}{q.trim() ? ` · “${q.trim()}”` : ""}</span>
            <label className="mk-sort">Sort
              <select value={sortKey[0]} aria-label="Sort markets"
                onChange={(e) => setSort([e.target.value, e.target.value === "und" ? 1 : -1])}>
                {sorts.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
              </select>
            </label>
            {view !== "perps" && (
              <button className="mk-toggle" aria-pressed={details} onClick={() => setDetails((v) => !v)}>
                {details ? "Overview" : <><span className="t-long">More measurements</span><span className="t-short">More</span></>}
              </button>)}
          </div>
          {overview ? (
            <>
              {rows.length > 0 && (
                <div className="mk-cols" aria-hidden="true">
                  <span>Market<small>Index · daily change</small></span>
                  <span>Last 30 days<small>Daily closes</small></span>
                  <span className="mk-cols-win">
                    <span>Next<small>Engine bars</small></span>
                    {LAYERS.map(([kind, name]) => <span key={kind}><i><LayerIcon kind={kind} size={13} />{name}</i>
                      <small>{kind === "engine" ? "Signal · regime" : kind === "wallets" ? "Smart wallets' options" : "Skew and taker flow"}</small></span>)}
                  </span>
                  <span />
                </div>)}
              <div className="mk-rows">
                {rows.map((c) => <MarketRow key={c.und} c={c} open={expanded === c.und}
                  onToggle={() => setExpanded((u) => (u === c.und ? null : c.und))} />)}
              </div>
            </>
          ) : (
            <div className="table-wrap">
              <table className="grid market-grid">
                <thead>
                  <tr>
                    {sortHead("und", "Market")}
                    <th className="hide-md">60D</th>
                    <th>Engine pair · 1D / 4H</th>
                    <th>Convergence</th>
                    {sortHead("z_1d", "Daily stretch", "num")}
                    {sortHead("heat_1d", "Daily heat", "num")}
                    {sortHead("oi_usd", "Perp OI", "num")}
                    {sortHead("funding_ann", "Funding / year", "num")}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.und} aria-label={`${c.und} market`}>
                      <td className="market-td">
                        <div className="market-cell">
                          <Link className="asset-link" to={`/coin/${c.und}`}><Asset und={c.und} compact /></Link>
                          <span className="market-price">${price(c.price)}<small className={c.chg_1d > 0 ? "up" : c.chg_1d < 0 ? "down" : "dim"}>{chg(c.chg_1d)}</small></span>
                        </div>
                      </td>
                      <td className="hide-md trace-td"><MarketTrace values={c.spark_1d} times={c.spark_times_1d} label={`${c.und} daily closes`} /></td>
                      <td><EnginePair comparison={c.engine_comparison} compact explain={false} /></td>
                      <td><Convergence comparison={c.engine_comparison} compact explain={false} /></td>
                      <td className="num">{c.signal_1d ? z(c.z_1d) : <Empty />}</td>
                      <td className="num">{c.signal_1d && c.heat_1d != null ? c.heat_1d : <Empty />}</td>
                      <td className="num">{usd(c.oi_usd)}</td>
                      <td className="num">{pct(c.funding_ann)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!rows.length && (
            <div className="empty-state">
              <Empty label="No markets in this view" />
              <button className="text-control" onClick={() => { setQ(""); setSignalFilter(null); setView("options"); }}>Reset filters</button>
            </div>
          )}
          <footer className="mk-foot">
            <span>{overview ? "Open a market for the figures behind each reading." : "Daily measurements from the engine and Derive's perps."}</span>
            <details>
              <summary>How to read this board</summary>
              <p>{BOARD_HELP}</p>
              {!overview && <p>{CONVERGENCE_HELP}</p>}
            </details>
          </footer>
        </section>
      </div>
    </div>
  );
}
