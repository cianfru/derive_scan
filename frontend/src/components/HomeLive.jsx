// The home cards drawn from Cowboy's own data (owner, 10 October 2026: the drawn icons looked cheap and the
// generated renders "too AI generated"): one large real figure and one small, exact chart per card, in
// the manner of a phone widget. Each reads a file the app already loads and is left out while it is missing.
import { useData } from "../lib/data.js";
import { usd, optionLabel, REGIME } from "../lib/format.js";
import { posseName } from "../lib/posses.js";
import { codename } from "../lib/walletName.js";
import { CoinIcon } from "./MarketVisuals.jsx";
import { WalletEmblem } from "./WalletTag.jsx";

const lastOf = (a) => { for (let i = (a || []).length - 1; i >= 0; i -= 1) if (Number.isFinite(a[i])) return a[i]; return null; };

/** Radar: every coin as one bar, above or below the line by how far its price sits from its trend (the
 * 1D engine's stretch), most stretched first; the most stretched coin named large. */
export function RadarLive() {
  const { data } = useData("radar.json");
  const coins = Object.entries(data?.coins || {}).map(([und, c]) => ({ und, z: lastOf(c.z) })).filter((c) => c.z != null)
    .sort((a, b) => b.z - a.z);
  if (!coins.length) return null;
  const top = coins.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
  const span = Math.max(1, ...coins.map((c) => Math.abs(c.z)));
  const n = coins.length, H = 48, mid = H / 2;
  return (
    <div className="hl hl-radar">
      <div className="hl-big"><b className={top.z >= 0 ? "up" : "down"}>{top.und}</b><span>{top.z >= 0 ? "furthest above its trend" : "furthest below its trend"}</span></div>
      <svg className="hl-bars" viewBox={`0 0 ${n * 10} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line x1="0" x2={n * 10} y1={mid} y2={mid} className="hl-base" vectorEffect="non-scaling-stroke" />
        {coins.map((c, i) => {
          const h = Math.max(1, (Math.abs(c.z) / span) * (mid - 1));
          return <rect key={c.und} x={i * 10 + 2} width="6" y={c.z >= 0 ? mid - h : mid} height={h} rx="1.5" className={c.z >= 0 ? "up" : "down"} />;
        })}
      </svg>
      <div className="hl-axis" aria-hidden="true">{coins.map((c) => <span key={c.und}>{c.und}</span>)}</div>
    </div>
  );
}

/** Smart traders: the three best-ranked wallets, the first large, with their options P&L. */
export function TradersLive() {
  const { data } = useData("traders.json");
  const top = (data?.traders || []).slice(0, 3);
  if (!top.length) return null;
  return (
    <ol className="hl hl-traders">
      {top.map((t, i) => (
        <li key={t.address} className={i === 0 ? "first" : ""}>
          <WalletEmblem address={t.address} size={i === 0 ? 46 : 28} />
          <span className="hl-who"><small>#{t.rank ?? i + 1}</small>{codename(t.address)}</span>
          <b className={t.option_pnl >= 0 ? "up" : "down"}>{t.option_pnl >= 0 ? "+" : ""}{usd(t.option_pnl)}</b>
        </li>
      ))}
    </ol>
  );
}

const MIX = ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"];
/** Markets: how many coins trend up on the last daily close, over the regime mix of the last 90 closes. */
export function MarketsLive() {
  const { data } = useData("markets.json");
  const b = data?.breadth_1d;
  if (!b?.rows?.length) return null;
  const cols = b.cols || MIX;
  const rows = b.rows.slice(-90);
  const last = rows[rows.length - 1];
  const total = last.slice(1).reduce((s, v) => s + (v || 0), 0);
  const up = last[1 + cols.indexOf("MARKUP")] || 0;
  return (
    <div className="hl hl-markets">
      <div className="hl-big"><b>{up}<small> of {total}</small></b><span>{REGIME.MARKUP.toLowerCase()} today</span></div>
      <svg className="hl-mix" viewBox={`0 0 ${rows.length} 40`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {rows.map((r, i) => {
          const n = r.slice(1).reduce((s, v) => s + (v || 0), 0) || 1;
          let y = 40;
          return cols.map((c, j) => {
            const h = ((r[1 + j] || 0) / n) * 40;
            y -= h;
            return h > 0 ? <rect key={`${i}${c}`} x={i} y={y} width={1.02} height={h} className={`hl-r-${c}`} /> : null;
          });
        })}
      </svg>
    </div>
  );
}

/** Posses: the Legends (the best results) and which way they lean on each coin they hold most. */
export function PossesLive() {
  const { data } = useData("traders.json");
  const g = data?.cohorts?.pnl?.find((c) => c.name === "Money Printer");
  if (!g) return null;
  const coins = Object.entries(g.coins || {}).sort((a, b) => (b[1].gross_delta_usd || 0) - (a[1].gross_delta_usd || 0)).slice(0, 3);
  const word = { up: "Long", defensive: "Short", neutral: "Balanced" };
  return (
    <div className="hl hl-posses">
      <div className="hl-big"><b>{g.wallets}</b><span>{posseName(g.name)}{g.wallets === 1 ? "" : "s"}, and how they lean</span></div>
      <ul className="hl-leans">
        {coins.map(([und, c]) => <li key={und} className={c.state}><CoinIcon und={und} /><span>{word[c.state] || "Balanced"}</span></li>)}
      </ul>
    </div>
  );
}

/** Options & flow: the largest options trade of the last 24 hours, and calls against puts bought. */
export function OptionsLive() {
  const { data } = useData("flow.json");
  if (!data) return null;
  const since = (Number(data.generated_at) || Date.now() / 1000) * 1000 - 864e5;
  const big = (data.large || []).filter((t) => t.kind === "option" && t.ts >= since).sort((a, b) => b.notional_usd - a.notional_usd)[0];
  let calls = 0, puts = 0;
  for (const c of Object.values(data.by_coin || {})) { calls += c.call?.buy_notional_usd || 0; puts += c.put?.buy_notional_usd || 0; }
  const share = calls + puts > 0 ? calls / (calls + puts) : null;
  if (!big && share == null) return null;
  const o = big ? optionLabel(big.instrument) : null;
  return (
    <div className="hl hl-options">
      {big && <div className="hl-big"><b>{usd(big.notional_usd)}</b><span>largest trade, 24h: {o.und} {o.type} {big.direction === "buy" ? "bought" : "sold"}, {o.expiryLabel}</span></div>}
      {share != null && <div className="hl-split">
        <div className="hl-bar" aria-hidden="true"><i className="up" style={{ width: `${share * 100}%` }} /><i className="down" /></div>
        <div className="hl-split-k"><span><b className="up">{Math.round(share * 100)}%</b> calls bought</span><span><b className="down">{100 - Math.round(share * 100)}%</b> puts bought</span></div>
      </div>}
    </div>
  );
}

export const HOME_LIVE = { radar: RadarLive, traders: TradersLive, markets: MarketsLive, posses: PossesLive, options: OptionsLive };
