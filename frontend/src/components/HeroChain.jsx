import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, REGIME, title } from "../lib/format.js";
import { Tabs } from "./ui.jsx";
import { Asset } from "./MarketVisuals.jsx";
import { ChainMini, LayerIcon, chainReadings, HORIZON_LABEL } from "./Chain.jsx";

function evidence(kind, coin, h) {
  const row = coin.align?.readings?.[h]?.[kind];
  if (kind === "engine") return coin.regime_1d ? `${REGIME[coin.regime_1d] || title(coin.regime_1d)} on the daily close` : "Daily close";
  if (kind === "wallets")
    return row?.net_delta_usd != null && row?.gross_delta_usd ? `${usd(row.net_delta_usd)} net delta of ${usd(row.gross_delta_usd)}` : "Ranked traders' open options";
  const rr = coin.rr25_30d;
  const move = coin.atm_iv_30d ? coin.atm_iv_30d * Math.sqrt(30 / 365) * 100 : null;
  return [move != null ? `±${move.toFixed(1)}% priced over 30 days` : null, rr != null ? `${rr < 0 ? "puts" : "calls"} richer by ${Math.abs(rr * 100).toFixed(1)} pts` : null]
    .filter(Boolean).join(" · ") || "Option prices";
}

/** Landing hero: the product itself. One coin read in three steps (regime, wallets, options), and every coin's chain below. */
export default function HeroChain() {
  const { data } = useData("markets.json");
  const [h, setH] = useState("30d");
  const coins = (data?.coins || []).filter((c) => c.has_options);
  const [pick, setPick] = useState(null);
  const ranked = [...coins].sort((a, b) => (b.align?.score ?? -9) - (a.align?.score ?? -9));
  const coin = coins.find((c) => c.und === pick) || coins.find((c) => c.und === "BTC") || ranked[0];
  if (!coin) return <div className="hero-chain loading-plate" aria-hidden="true" />;
  const r = chainReadings(coin.align, h);
  const agreed = r[0].state && r[0].state !== "neutral" && r.every((x) => x.state === r[0].state);
  return (
    <div className="hero-chain">
      <div className="hc-plate">
        <div className="hc-head">
          <Link to={`/coin/${coin.und}`} className="asset-link"><Asset und={coin.und} /></Link>
          <Tabs label="Horizon" value={h} onChange={setH} items={[["7d", "7 days"], ["30d", "30 days"]]} />
        </div>
        <div className={`hc-steps${agreed ? ` agreed ${r[0].state}` : ""}`}>
          {r.map((x, i) => (
            <Link key={x.kind} to={`/coin/${coin.und}#${x.anchor}`} className={`hc-step ${x.state || "unknown"}`}>
              <span className="hc-num">0{i + 1}</span>
              <span className="hc-ico"><LayerIcon kind={x.kind} size={22} /></span>
              <span className="hc-body"><small>{x.name}</small><b>{x.text}</b><em>{evidence(x.kind, coin, h)}</em></span>
            </Link>))}
        </div>
        <p className="hc-foot">{agreed ? <b>All three point the same way · {HORIZON_LABEL[h].toLowerCase()}</b> : <>Three separate reads · {HORIZON_LABEL[h].toLowerCase()}</>}</p>
      </div>
      <div className="hc-all" aria-label="Every coin with options">
        {ranked.map((c) => (
          <button key={c.und} className={c.und === coin.und ? "on" : ""} onClick={() => setPick(c.und)} aria-pressed={c.und === coin.und}>
            <span>{c.und}</span><ChainMini alignment={c.align} horizon={h} />
          </button>))}
      </div>
    </div>
  );
}
