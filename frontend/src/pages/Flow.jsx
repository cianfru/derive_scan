import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, ago, optionLabel } from "../lib/format.js";
import { Plate, Tabs, Loading, Failed, Lead } from "../components/ui.jsx";
import MarketResearchHeader from "../components/MarketResearchHeader.jsx";
import { flowLead } from "../lib/takeaway.js";
import { FlowCoverage } from "../components/AnalyticalDetails.jsx";
import FlowSummary from "../components/FlowSummary.jsx";
import WalletTag from "../components/WalletTag.jsx";
import { TYPE as CLASS } from "../lib/traders.js";
import "../flow-page.css";

const CLASS_INFO = "Wallet types from every trade on Derive since December 2023. Directional traders who are in profit on options that have expired are ranked: Top (best fifth), Smart (the best 50, or every Top wallet when Top is larger), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";
const CAP = 15;
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

function useSampleSize() {
  const [small, setSmall] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 680px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 680px)");
    const update = () => setSmall(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return small ? 5 : CAP;
}

function Kind({ c }) {
  return c ? <span className={c === "top" || c === "smart" ? "tier-tag" : "dim"}>{CLASS[c] || c}</span> : <span className="faint">—</span>;
}

function Who({ w, ranked }) {
  const tag = <WalletTag address={w} size={18} />;
  return ranked ? <Link to={`/trader/${w.toLowerCase()}`} onClick={(e) => e.stopPropagation()}>{tag}</Link> : tag;
}

export default function Flow() {
  const { data, error } = useData("flow.json", 2 * 60_000);
  const [selected, setSelected] = useState("all");
  const [kind, setKind] = useState("option");
  const [all, setAll] = useState(false);
  const [allWallets, setAllWallets] = useState(false);
  const [view, setView] = useState("trades");
  const [focusRequest, setFocusRequest] = useState(0);
  const resultRef = useRef(null);
  const cap = useSampleSize();
  useEffect(() => {
    if (!focusRequest) return;
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView?.({ behavior: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [focusRequest]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const matching = data.large.filter((t) => (selected === "all" || t.underlying === selected) && (kind === "all" || t.kind === kind));
  const large = all ? matching : matching.slice(0, cap);
  const wallets = allWallets ? data.wallets : data.wallets.slice(0, cap);
  const showTrades = () => { setView("trades"); setFocusRequest((n) => n + 1); };
  return (
    <div className="wrap page people-page market-research-page flow-page research-refined">
      <MarketResearchHeader error={error} title="Flow" description="Recorded trades and option premium across markets."
        info="The premium overview and active wallet list cover the recorded 24-hour window across all markets. Selecting a market or instrument kind filters only the large-trade sample below."
        meta={<FlowCoverage coverage={data.coverage} as="span" />} />
      <Lead lead={flowLead(data)} />
      <Plate title="Options premium by market" className="fl-premium-panel" bodyClass="flush">
        <FlowSummary data={data} selected={selected} onSelect={(u) => { setSelected(u); setAll(false); }}
          selectionCount={matching.length} selectionKind={kind === "option" ? "option trades" : kind === "perp" ? "perp trades" : "trades"} onViewTrades={showTrades} />
      </Plate>
      <div className="fl-view-switch"><Tabs label="Flow detail" value={view} onChange={setView} items={[["trades", "Large trades"], ["wallets", "Active wallets"]]} /></div>
      {view === "trades" ? <Plate title={<span ref={resultRef} tabIndex={-1}>Large trades</span>} className="fl-trades-panel" bodyClass="flush"
        info={"Up to 80 of the largest recorded taker trades across all markets; the market filter applies to that sample. Trades that crossed the spread at $25K or more on perps, $100K notional or $2K premium on options. RFQ marks block trades negotiated off the book. " + CLASS_INFO}
        right={<>
          {selected !== "all" && <button className="text-control" onClick={() => { setSelected("all"); setAll(false); }}>{selected} · Clear</button>}
          <Tabs label="Kind" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["option", "Options"], ["perp", "Perps"], ["all", "All"]]} />
        </>}>
        <div className="fl-table-context" role="status">
          <span>Recorded large-trade sample</span>
          <span>{selected === "all" ? "All markets" : selected} · <b>{large.length}</b> of <b>{matching.length}</b> trades</span>
        </div>
        <table className="grid flow-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Instrument</th><th scope="col">Side</th><th scope="col" className="num">Notional</th><th scope="col" className="num">Premium</th><th scope="col">Wallet</th><th scope="col">Type</th></tr></thead>
          <tbody>
            {large.map((t, i) => (
              <tr key={i} className="ft-row">
                <td className="ft-time dim" data-k="Time">{ago(t.ts / 1000)}</td>
                <td className="ft-inst">
                  <Link to={`/coin/${t.underlying}#${t.kind === "option" ? "options" : "regime"}`} className="mono">
                    {t.kind === "option" ? optionLabel(t.instrument).display : `${t.underlying} perpetual`}
                  </Link>
                  {t.rfq ? <span className="faint ft-rfq">RFQ</span> : null}
                </td>
                <td className="ft-side" data-k="Side">{t.direction === "buy" ? "Buy" : "Sell"}</td>
                <td className="num ft-notional" data-k="Notional">{usd(t.notional_usd)}</td>
                <td className="num hero ft-prem" data-k="Premium">{t.kind === "option" ? usd(t.premium_usd) : <span className="faint">—</span>}</td>
                <td className="ft-who"><Who w={t.wallet} ranked={t.ranked} /></td>
                <td className="ft-kind" data-k="Type"><Kind c={t.class} /></td>
              </tr>))}
            {!large.length && <tr><td colSpan={7} className="faint fl-empty"><span aria-label="No matching recorded large trades">—</span></td></tr>}
          </tbody>
        </table>
        {(matching.length > cap || all) && <button className="btn lb-more" onClick={() => setAll((value) => !value)}>{all ? "Show fewer trades" : `Show all ${matching.length} trades`}</button>}
      </Plate> : <Plate title="Most active wallets" className="fl-wallets-panel" bodyClass="flush" right={<span className="fl-scope">All markets · 24h</span>}
        info={"Volume and realised profit and loss per wallet from Derive's public trades over 24 hours. Premium net is what the wallet received for options sold minus what it paid for options bought. " + CLASS_INFO}>
        <div className="fl-table-context"><span>Most active in the recorded window</span><span><b>{wallets.length}</b> of <b>{data.wallets.length}</b> wallets</span></div>
        <table className="grid flow-table wallets-table">
          <thead><tr><th scope="col">Wallet</th><th scope="col">Type</th><th scope="col" className="num">Perp volume</th><th scope="col" className="num">Options notional</th><th scope="col" className="num">Premium net</th><th scope="col" className="num">Realised PnL</th></tr></thead>
          <tbody>
            {wallets.map((w) => {
              const net = w.premium_sold_usd - w.premium_bought_usd;
              return (
                <tr key={w.wallet} className="fw-row">
                  <td className="fw-who"><Who w={w.wallet} ranked={w.ranked} /></td>
                  <td className="fw-kind" data-k="Type"><Kind c={w.class} /></td>
                  <td className="num fw-perp" data-k="Perp volume">{usd(w.perp_notional_usd)}</td>
                  <td className="num fw-opt" data-k="Options notional">{usd(w.option_notional_usd)}</td>
                  <td className={`num fw-net ${tone(net)}`} data-k="Premium net">{w.premium_bought_usd || w.premium_sold_usd ? usd(net) : <span className="faint">—</span>}</td>
                  <td className={`num hero fw-pnl ${tone(w.realized_pnl_usd)}`} data-k="Realised PnL">{usd(w.realized_pnl_usd)}</td>
                </tr>);
            })}
            {!wallets.length && <tr><td colSpan={6} className="faint fl-empty"><span aria-label="No recorded active wallets">—</span></td></tr>}
          </tbody>
        </table>
        {(data.wallets.length > cap || allWallets) && <button className="btn lb-more" onClick={() => setAllWallets((value) => !value)}>{allWallets ? "Show fewer wallets" : `Show all ${data.wallets.length} wallets`}</button>}
      </Plate>}
    </div>
  );
}
