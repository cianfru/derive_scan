import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, ago, price } from "../lib/format.js";
import { Plate, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import { FlowCoverage } from "../components/AnalyticalDetails.jsx";
import FlowSummary from "../components/FlowSummary.jsx";
import WalletTag from "../components/WalletTag.jsx";

import { TYPE as CLASS } from "../lib/traders.js";
const CLASS_INFO = "Wallet types from every trade on Derive since December 2023. Directional traders who are in profit on options that have expired are ranked: Top (best fifth), Smart (best 50), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";

function Kind({ c }) {
  return c ? <span className={c === "top" || c === "smart" ? "orange" : "dim"} style={{ fontSize: 12 }}>{CLASS[c] || c}</span> : <span className="faint">-</span>;
}

function Who({ w, ranked }) {
  const tag = <WalletTag address={w} size={18} />;
  return ranked ? <Link to={`/trader/${w.toLowerCase()}`} onClick={(e) => e.stopPropagation()}>{tag}</Link> : tag;
}

export default function Flow() {
  const { data, error } = useData("flow.json", 2 * 60_000);
  const [selected,setSelected] = useState("all");
  const [kind, setKind] = useState("option");
  const [all, setAll] = useState(false);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const matching = data.large.filter((t) => (selected === "all" || t.underlying === selected) && (kind === "all" || t.kind === kind));
  const large = all ? matching : matching.slice(0, 25);
  return (
    <div className="wrap page">
      <div>
        <h1>Flow</h1>
        <p className="sub">Where option premium is moving. Inspect the activity, then open the trades behind it.</p>
      </div>
      <FlowCoverage coverage={data.coverage} />
      <FlowSummary data={data} selected={selected} onSelect={setSelected}/>
      {!data.classes_ready && <p className="status">Wallet classification is still building. Activity is shown without a Smart label.</p>}
      <div style={{ display: "grid", gap: 16 }}>
        <details className="flow-tape"><summary>Inspect {selected === "all" ? "all markets" : selected} / large-trade tape <span>{matching.length} recorded trades</span></summary><Plate title="Large trades" info="Up to 80 of the largest recorded taker trades across all markets; the market filter applies to that sample. Trades that crossed the spread at $25K or more on perps, $100K notional or $2K premium on options. RFQ marks block trades negotiated off the book."
          right={<Tabs label="Kind" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["option", "Options"], ["perp", "Perps"], ["all", "All"]]} />} bodyClass="table-wrap">
          <table className="grid" style={{ minWidth: 720 }}>
            <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th className="num">Notional</th><th className="num">Premium</th><th>Wallet</th><th>Type <Info>{CLASS_INFO}</Info></th></tr></thead>
            <tbody>
              {large.map((t, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="dim">{ago(t.ts / 1000)}</td>
                  <td><Link to={`/coin/${t.underlying}#${t.kind === "option" ? "options" : "regime"}`} style={{ fontWeight: 600 }}>{t.kind === "option" ? `${t.underlying} $${price(Number(t.instrument.split("-")[2].replace("_", ".")))} ${t.instrument.endsWith("-C") ? "call" : "put"}` : `${t.underlying} perpetual`}</Link>{t.kind === "option" && <small className="dim">Expiry {t.instrument.split("-")[1]?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</small>}{t.rfq ? <span className="status" style={{ marginLeft: 8 }}>RFQ</span> : null}</td>
                  <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "Buy" : "Sell"}</td>
                  <td className="num">{usd(t.notional_usd)}</td>
                  <td className="num">{t.kind === "option" ? usd(t.premium_usd) : <span className="faint">-</span>}</td>
                  <td><Who w={t.wallet} ranked={t.ranked} /></td>
                  <td><Kind c={t.class} /></td>
                </tr>))}
              {!large.length && <tr><td colSpan={7} className="dim">No large trades in the collected portion of this window.</td></tr>}
            </tbody>
          </table>
          {matching.length > large.length && <button className="btn" style={{ marginTop: 12 }} onClick={() => setAll(true)}>Show all {matching.length}</button>}
        </Plate>
        </details><details className="flow-tape"><summary>Inspect active wallets <span>Across all markets / 24h</span></summary><Plate title="Most active wallets, 24h" info="Volume and realised profit and loss per wallet from Derive's public trades. Premium is what the wallet paid for options (bought) and received (sold)." bodyClass="table-wrap">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead><tr><th>Wallet</th><th>Type <Info>{CLASS_INFO}</Info></th><th className="num">Perp volume</th><th className="num">Options notional</th><th className="num">Premium net</th><th className="num">Realised PnL</th></tr></thead>
            <tbody>
              {data.wallets.map((w) => {
                const net = w.premium_sold_usd - w.premium_bought_usd;
                return (
                  <tr key={w.wallet} style={{ cursor: "default" }}>
                    <td><Who w={w.wallet} ranked={w.ranked} /></td>
                    <td><Kind c={w.class} /></td>
                    <td className="num">{usd(w.perp_notional_usd)}</td>
                    <td className="num">{usd(w.option_notional_usd)}</td>
                    <td className={`num ${net > 0 ? "up" : net < 0 ? "down" : ""}`}>{w.premium_bought_usd || w.premium_sold_usd ? usd(net) : <span className="faint">-</span>}</td>
                    <td className={`num ${w.realized_pnl_usd > 0 ? "up" : w.realized_pnl_usd < 0 ? "down" : ""}`}>{usd(w.realized_pnl_usd)}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </Plate>
        </details>
      </div>
      <p className="status">Since {new Date(data.since * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · refreshed every 15 minutes</p>
    </div>
  );
}
