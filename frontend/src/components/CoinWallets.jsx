import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd } from "../lib/format.js";
import { viewReading } from "../lib/presentation.js";
import { TYPE, typeOf } from "../lib/traders.js";
import { Plate, Tabs, Info, Loading } from "./ui.jsx";
import WalletTag from "./WalletTag.jsx";

const day = (t) => new Date(t * 1000).toISOString().slice(5, 10);
const tone = (s) => (s == null ? "dim" : s >= 0.25 ? "up" : s <= -0.25 ? "down" : "dim");

function DeltaBar({ score }) {
  if (score == null) return <span className="delta-bar" />;
  const color = score >= 0.25 ? "var(--up)" : score <= -0.25 ? "var(--down)" : "var(--sig-wait)";
  return <span className="delta-bar"><i style={{ left: `${50 + Math.min(0, score) * 50}%`, width: `${Math.max(2, Math.abs(score) * 50)}%`, background: color }} /></span>;
}

function SmartRead({ alignment }) {
  return (
    <div className="wallet-read">
      {["7d", "30d"].map((h) => {
        const { label, state, row } = viewReading(alignment, h, "wallets");
        return (
          <div key={h}>
            <span>Smart wallets · {h === "7d" ? "next 7 days" : "next 30 days"}</span>
            <strong className={state === "up" ? "up" : state === "defensive" ? "down" : ""}>{label}</strong>
            <small>{row?.net_delta_usd != null ? `${usd(row.net_delta_usd)} net of ${usd(row.gross_delta_usd)}` : " "}</small>
            <small>{row?.positions ? `${row.positions} positions` : ""}</small>
          </div>);
      })}
    </div>
  );
}

function Cohorts({ cohorts }) {
  const [dim, setDim] = useState("pnl");
  const [win, setWin] = useState("30d");
  const rows = (cohorts?.[dim] || []).filter((c) => c[win]?.positions);
  return (
    <Plate title="Cohorts on this coin" info="Every options trader on Derive except market makers, grouped by results on expired options (Money Printer to Giga-Rekt) or by premium traded (Leviathan to Shrimp). Each bar is the net delta of the group's open options on this coin as a share of its gross delta: right and green gains from a rise, left and red from a fall."
      right={<span style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <Tabs label="Group by" value={dim} onChange={setDim} items={[["pnl", "Results"], ["size", "Size"]]} />
        <Tabs label="Expiries" value={win} onChange={setWin} items={[["7d", "7d"], ["30d", "30d"], ["all", "All"]]} /></span>}>
      {rows.length ? (
        <div className="cohort-rows">
          {rows.map((c) => (
            <div key={c.name} className="cohort-row">
              <span className="name"><b>{c.name}</b><small>{c[win].positions} pos.</small></span>
              <DeltaBar score={c[win].score} />
              <span className={`delta-num ${tone(c[win].score)}`}>{c[win].net_delta_usd == null ? "-" : usd(c[win].net_delta_usd)}</span>
            </div>))}
        </div>) : <p className="status">No open positions in this window.</p>}
    </Plate>
  );
}

function Holders({ holders, total }) {
  return (
    <Plate title="Who holds it" info="Ranked options traders with open options on this coin, biggest dollar delta first, valued on the newest options chain. Positive delta gains from a rise. Market makers are never listed. Open a trader for the full book."
      right={total ? <span className="status">{total} ranked traders</span> : null}>
      {holders?.length ? (
        <div className="holders">
          {holders.map((h) => {
            const leg = h.legs?.[0];
            return (
              <Link key={h.address} className="holder" to={`/trader/${h.address.toLowerCase()}`}>
                <span className="who"><WalletTag address={h.address} size={22} />
                  <small>{h.tier ? <b>{TYPE[h.tier]}</b> : TYPE[h.class] || "Trader"} · #{h.rank}{h.pnl_cohort ? ` · ${h.pnl_cohort}` : ""}</small></span>
                <span className="leg">{leg ? <>{leg.net > 0 ? "Long" : "Short"} {leg.strike.toLocaleString()} {leg.type === "C" ? "call" : "put"} · {day(leg.expiry)}</> : ""}
                  {h.positions > 1 ? <em>{" "}and {h.positions - 1} more</em> : null}</span>
                <span className={`delta-num ${h.net_delta_usd > 0 ? "up" : h.net_delta_usd < 0 ? "down" : ""}`}>{usd(h.net_delta_usd)}</span>
              </Link>);
          })}
        </div>) : <p className="status">No ranked trader holds options on this coin right now.</p>}
    </Plate>
  );
}

/** Step 2 of the coin page: what the ranked options traders hold on this coin. */
export default function CoinWallets({ und, alignment }) {
  const { data } = useData(`wallets/${und}.json`, 5 * 60_000);
  return (
    <>
      <SmartRead alignment={alignment} />
      {!data ? <Loading /> : !data.ready ? (
        <p className="status">Wallet history is {data.status === "backfilling" ? "still being rebuilt" : "updating"} (through {data.through || "-"}).
          <Info>Positions come from every trade on Derive, rebuilt day by day. They appear once the history has caught up.</Info></p>
      ) : (
        <div className="wallet-grid">
          <Holders holders={data.holders} total={data.holders_total} />
          <Cohorts cohorts={data.cohorts} />
        </div>)}
    </>
  );
}
