import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, ago, optionLabel } from "../lib/format.js";
import { Plate, Tabs, Loading, Failed, PageHead } from "../components/ui.jsx";
import { FlowCoverage } from "../components/AnalyticalDetails.jsx";
import FlowSummary from "../components/FlowSummary.jsx";
import WalletTag from "../components/WalletTag.jsx";
import { TYPE as CLASS } from "../lib/traders.js";

const CLASS_INFO = "Wallet types from every trade on Derive since December 2023. Directional traders who are in profit on options that have expired are ranked: Top (best fifth), Smart (best 50), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";
const CAP = 15;
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

function Kind({ c }) {
  return c ? <span className={c === "top" || c === "smart" ? "tier-tag" : "dim"}>{CLASS[c] || c}</span> : <span className="faint">–</span>;
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
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const matching = data.large.filter((t) => (selected === "all" || t.underlying === selected) && (kind === "all" || t.kind === kind));
  const large = all ? matching : matching.slice(0, CAP);
  return (
    <div className="wrap page people-page flow-page">
      <PageHead title="Flow" meta={<FlowCoverage coverage={data.coverage} as="span" />} />
      <FlowSummary data={data} selected={selected} onSelect={(u) => { setSelected(u); setAll(false); }} />
      <Plate title="Large trades" bodyClass="flush"
        info={"Up to 80 of the largest recorded taker trades across all markets; the market filter applies to that sample. Trades that crossed the spread at $25K or more on perps, $100K notional or $2K premium on options. RFQ marks block trades negotiated off the book. " + CLASS_INFO}
        right={<>
          {selected !== "all" && <button className="text-control" onClick={() => setSelected("all")}>{selected} · Clear</button>}
          <Tabs label="Kind" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["option", "Options"], ["perp", "Perps"], ["all", "All"]]} />
        </>}>
        <table className="grid flow-table">
          <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th className="num">Notional</th><th className="num">Premium</th><th>Wallet</th><th>Type</th></tr></thead>
          <tbody>
            {large.map((t, i) => (
              <tr key={i} className="ft-row">
                <td className="ft-time dim">{ago(t.ts / 1000)}</td>
                <td className="ft-inst">
                  <Link to={`/coin/${t.underlying}#${t.kind === "option" ? "options" : "regime"}`} className="mono">
                    {t.kind === "option" ? optionLabel(t.instrument).display : `${t.underlying} perpetual`}
                  </Link>
                  {t.rfq ? <span className="faint ft-rfq">RFQ</span> : null}
                </td>
                <td className="ft-side">{t.direction === "buy" ? "Buy" : "Sell"}</td>
                <td className="num ft-notional" data-k="Notional">{usd(t.notional_usd)}</td>
                <td className="num hero ft-prem">{t.kind === "option" ? usd(t.premium_usd) : <span className="faint">–</span>}</td>
                <td className="ft-who"><Who w={t.wallet} ranked={t.ranked} /></td>
                <td className="ft-kind"><Kind c={t.class} /></td>
              </tr>))}
            {!large.length && <tr><td colSpan={7} className="faint">—</td></tr>}
          </tbody>
        </table>
        {matching.length > large.length && <button className="btn lb-more" onClick={() => setAll(true)}>Show all {matching.length}</button>}
      </Plate>
      <Plate title="Most active wallets" bodyClass="flush"
        info={"Volume and realised profit and loss per wallet from Derive's public trades over 24 hours. Premium net is what the wallet received for options sold minus what it paid for options bought. " + CLASS_INFO}>
        <table className="grid flow-table wallets-table">
          <thead><tr><th>Wallet</th><th>Type</th><th className="num">Perp volume</th><th className="num">Options notional</th><th className="num">Premium net</th><th className="num">Realised PnL</th></tr></thead>
          <tbody>
            {data.wallets.map((w) => {
              const net = w.premium_sold_usd - w.premium_bought_usd;
              return (
                <tr key={w.wallet} className="fw-row">
                  <td className="fw-who"><Who w={w.wallet} ranked={w.ranked} /></td>
                  <td className="fw-kind"><Kind c={w.class} /></td>
                  <td className="num fw-perp" data-k="Perps">{usd(w.perp_notional_usd)}</td>
                  <td className="num fw-opt" data-k="Options">{usd(w.option_notional_usd)}</td>
                  <td className={`num fw-net ${tone(net)}`} data-k="Premium">{w.premium_bought_usd || w.premium_sold_usd ? usd(net) : <span className="faint">–</span>}</td>
                  <td className={`num hero fw-pnl ${tone(w.realized_pnl_usd)}`}>{usd(w.realized_pnl_usd)}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </Plate>
    </div>
  );
}
