import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, shortAddr, ago, price } from "../lib/format.js";
import { Plate, Tabs, Loading, Failed, Info } from "../components/ui.jsx";

const CLASS = { top: "Top", smart: "Smart", profitable: "Profitable", directional: "Directional", income: "Income", hedger: "Hedger", occasional: "Occasional" };
const CLASS_INFO = "Wallet types from every trade on Derive since December 2023. Directional traders who are in profit on options that have expired are ranked: Top (best fifth), Smart (best 50), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";

function Kind({ c }) {
  return c ? <span className={c === "top" || c === "smart" ? "orange" : "dim"} style={{ fontSize: 12 }}>{CLASS[c] || c}</span> : <span className="faint">-</span>;
}

export default function Flow() {
  const { data, error } = useData("flow.json", 2 * 60_000);
  const [kind, setKind] = useState("option");
  const [all, setAll] = useState(false);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const matching = data.large.filter((t) => kind === "all" || t.kind === kind);
  const large = all ? matching : matching.slice(0, 25);
  return (
    <div className="wrap page">
      <div>
        <h1>Flow</h1>
        <p className="sub">The largest trades on Derive in the last 24 hours, and the wallets behind the most volume.{data.classes_ready ? " Market makers left out." : ""}</p>
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        <Plate title="Large trades" info="Trades that crossed the spread at $25K or more on perps, $100K notional or $2K premium on options. RFQ marks block trades negotiated off the book."
          right={<Tabs label="Kind" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["option", "Options"], ["perp", "Perps"], ["all", "All"]]} />} bodyClass="table-wrap">
          <table className="grid" style={{ minWidth: 720 }}>
            <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th className="num">Notional</th><th className="num">Premium</th><th>Wallet</th><th>Type <Info>{CLASS_INFO}</Info></th></tr></thead>
            <tbody>
              {large.map((t, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="dim">{ago(t.ts / 1000)}</td>
                  <td><Link to={`/coin/${t.underlying}`} style={{ fontWeight: 600 }}>{t.instrument}</Link>{t.rfq ? <span className="status" style={{ marginLeft: 8 }}>RFQ</span> : null}</td>
                  <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "Buy" : "Sell"}</td>
                  <td className="num">{usd(t.notional_usd)}</td>
                  <td className="num">{t.kind === "option" ? usd(t.premium_usd) : <span className="faint">-</span>}</td>
                  <td className="dim">{shortAddr(t.wallet)}</td>
                  <td><Kind c={t.class} /></td>
                </tr>))}
              {!large.length && <tr><td colSpan={7} className="dim">No large trades in this window.</td></tr>}
            </tbody>
          </table>
          {matching.length > large.length && <button className="btn" style={{ marginTop: 12 }} onClick={() => setAll(true)}>Show all {matching.length}</button>}
        </Plate>
        <Plate title="Most active wallets, 24h" info="Volume and realised profit and loss per wallet from Derive's public trades. Premium is what the wallet paid for options (bought) and received (sold)." bodyClass="table-wrap">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead><tr><th>Wallet</th><th>Type <Info>{CLASS_INFO}</Info></th><th className="num">Perp volume</th><th className="num">Options notional</th><th className="num">Premium net</th><th className="num">Realised PnL</th></tr></thead>
            <tbody>
              {data.wallets.map((w) => {
                const net = w.premium_sold_usd - w.premium_bought_usd;
                return (
                  <tr key={w.wallet} style={{ cursor: "default" }}>
                    <td>{shortAddr(w.wallet)}</td>
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
      </div>
      <p className="status">Since {new Date(data.since * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · refreshed every 15 minutes</p>
    </div>
  );
}
