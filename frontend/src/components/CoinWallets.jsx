import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, strike } from "../lib/format.js";
import { viewReading } from "../lib/presentation.js";
import { TYPE } from "../lib/traders.js";
import { Plate, Tabs, Loading, Empty } from "./ui.jsx";
import WalletTag from "./WalletTag.jsx";

const day = (t) => new Date(t * 1000).toISOString().slice(5, 10);
const tone = (s) => (s == null ? "dim" : s >= 0.25 ? "up" : s <= -0.25 ? "down" : "dim");
const HOLDERS_SHOWN = 8;

/** A centred bar: length is the row's net delta against the column's largest absolute value. */
function DeltaBar({ value, max, score }) {
  if (value == null || !max) return <span className="delta-bar" />;
  const share = Math.max(-1, Math.min(1, value / max));
  const color = tone(score) === "up" ? "var(--up)" : tone(score) === "down" ? "var(--down)" : "var(--sig-wait)";
  return <span className="delta-bar"><i style={{ left: `${50 + Math.min(0, share) * 50}%`, width: `${Math.max(1, Math.abs(share) * 50)}%`, background: color }} /></span>;
}

function SmartRead({ alignment }) {
  return (
    <div className="wallet-read">
      {["7d", "30d"].map((h) => {
        const { label, state, row } = viewReading(alignment, h, "wallets");
        return (
          <div key={h}>
            <span>{h === "7d" ? "7D" : "30D"}</span>
            <strong className={state === "up" ? "up" : state === "defensive" ? "down" : ""}>{label}</strong>
            <small>{row?.net_delta_usd != null ? <>{usd(row.net_delta_usd)} net of {usd(row.gross_delta_usd)}{row.positions ? ` · ${row.positions} pos.` : ""}</> : <Empty />}</small>
          </div>);
      })}
    </div>
  );
}

function Cohorts({ cohorts }) {
  const [dim, setDim] = useState("pnl");
  const [win, setWin] = useState("30d");
  const rows = (cohorts?.[dim] || []).filter((c) => c[win]?.positions);
  const max = Math.max(0, ...rows.map((c) => Math.abs(c[win].net_delta_usd || 0)));
  return (
    <Plate className="cohorts-plate" title="Cohorts" info="Every options trader on Derive except market makers, grouped by results on expired options (Money Printer to Giga-Rekt) or by premium traded (Leviathan to Shrimp). Each bar is the group's net dollar delta on this coin's open options, scaled to the largest group in the list: right gains from a rise, left from a fall. Colour shows the net as a share of the group's gross delta: green or red past a quarter, grey in between."
      right={<Tabs label="Expiries" value={win} onChange={setWin} items={[["7d", "7D"], ["30d", "30D"], ["all", "All"]]} />}>
      <Tabs label="Group by" value={dim} onChange={setDim} items={[["pnl", "Results"], ["size", "Size"]]} />
      {rows.length ? (
        <div className="cohort-rows">
          {rows.map((c) => (
            <div key={c.name} className="cohort-row">
              <span className="name"><b>{c.name}</b><small className="mono">{c[win].positions} pos.</small></span>
              <DeltaBar value={c[win].net_delta_usd} max={max} score={c[win].score} />
              <span className={`delta-num ${tone(c[win].score)}`}>{c[win].net_delta_usd == null ? <Empty /> : usd(c[win].net_delta_usd)}</span>
            </div>))}
        </div>) : <p className="status">No open positions in this window.</p>}
    </Plate>
  );
}

function Holders({ holders, total }) {
  const shown = (holders || []).slice(0, HOLDERS_SHOWN);
  const count = Math.max(total || 0, holders?.length || 0);
  return (
    <Plate className="holders-plate" title="Who holds it" info="Ranked options traders with open options on this coin, biggest dollar delta first, valued on the newest options chain. The leg is their largest position; +N counts the others. Positive delta gains from a rise. Market makers are never listed.">
      {shown.length ? (
        <>
          <div className="holders">
            {shown.map((h) => {
              const leg = h.legs?.[0];
              return (
                <Link key={h.address} className="holder" to={`/trader/${h.address.toLowerCase()}`}>
                  <span className="who"><WalletTag address={h.address} size={22} />
                    <small>{h.tier ? <b>{TYPE[h.tier]}</b> : TYPE[h.class] || "Trader"} · #{h.rank}{h.pnl_cohort ? ` · ${h.pnl_cohort}` : ""}</small></span>
                  <span className="leg">{leg ? <>{leg.net > 0 ? "Long" : "Short"} {strike(leg.strike, "")} {leg.type === "C" ? "call" : "put"} · {day(leg.expiry)}</> : <Empty />}
                    {h.positions > 1 ? <em> +{h.positions - 1}</em> : null}</span>
                  <span className={`delta-num ${h.net_delta_usd > 0 ? "up" : h.net_delta_usd < 0 ? "down" : ""}`}>{usd(h.net_delta_usd)}</span>
                </Link>);
            })}
          </div>
          {count > 0 && <Link className="text-link holders-all" to="/traders">All {count} traders</Link>}
        </>) : <p className="status">No ranked trader holds options on this coin right now.</p>}
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
        <p className="status">Wallet positions appear once the trade history has caught up{data.through ? ` (through ${data.through})` : ""}.</p>
      ) : (
        <div className="wallet-grid">
          <Holders holders={data.holders} total={data.holders_total} />
          <Cohorts cohorts={data.cohorts} />
        </div>)}
    </>
  );
}
