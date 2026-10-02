import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { pct, price, utc } from "../lib/format.js";
import { Plate, Loading, Failed, Info } from "../components/ui.jsx";

function MiniTerm({ term }) {
  if (!term || term.length < 2) return <div className="status" style={{ height: 56, display: "grid", placeItems: "center" }}>Too few expiries for a curve</div>;
  const W = 220, H = 56, lt = (d) => Math.log(1 + d), tmax = Math.max(...term.map((t) => t[0]));
  const ivs = term.map((t) => t[1]), lo = Math.min(...ivs), hi = Math.max(...ivs), r = hi - lo || 0.01;
  const pts = term.map((t) => [4 + (lt(t[0]) / lt(tmax)) * (W - 8), 6 + (1 - (t[1] - lo) / r) * (H - 12)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={`${d}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`} fill="var(--orange-glow)" />
      <path d={d} fill="none" stroke="var(--orange)" strokeWidth="2" />
    </svg>
  );
}

function SkewBar({ rr }) {
  if (rr == null) return <span className="faint">-</span>;
  const w = Math.min(50, Math.abs(rr) * 100 * 6);
  return (
    <span className="meter" style={{ gridTemplateColumns: "80px auto" }}>
      <i className="center"><b style={{ left: rr < 0 ? `${50 - w}%` : "50%", width: `${w}%`, background: rr < 0 ? "var(--sig-exit)" : "var(--orange)" }} /></i>
      <span className="mono">{rr > 0 ? "+" : ""}{(rr * 100).toFixed(2)}</span>
    </span>
  );
}

export default function Options() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const coins = data.coins.filter((c) => c.options).sort((a, b) => (b.options.option_oi_contracts * (b.price || 0)) - (a.options.option_oi_contracts * (a.price || 0)));
  return (
    <div className="wrap page">
      <div>
        <h1>Options</h1>
        <p className="sub">Every coin with options on Derive: how much volatility is priced, how the curve is shaped, and which side pays for protection.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
        {coins.map((c) => {
          const o = c.options;
          const t = (o.term || []).filter((x) => x[0] >= 1);
          const slope = t.length >= 2 ? t[t.length - 1][1] - t[0][1] : null;
          return (
            <section key={c.und} className="plate" style={{ cursor: "pointer" }} onClick={() => nav(`/coin/${c.und}`)}
              tabIndex={0} onKeyDown={(e) => e.key === "Enter" && nav(`/coin/${c.und}`)}>
              <div className="plate-h">
                <span style={{ font: "700 20px/1 var(--font-display)", letterSpacing: ".03em" }}>{c.und}</span>
                <span className="mono dim" style={{ fontSize: 13 }}>{price(c.price)}</span>
              </div>
              <div className="plate-b" style={{ display: "grid", gap: 12 }}>
                <MiniTerm term={o.term} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>IV 30d</span><strong style={{ fontSize: 17 }}>{pct(o.atm_iv_30d)}</strong></div>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>Curve</span>
                    <strong style={{ fontSize: 13 }} className={slope < 0 ? "down" : ""}>{slope == null ? "-" : slope < 0 ? "Inverted" : "Upward"}</strong></div>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>Put / call</span><strong style={{ fontSize: 17 }}>{o.pc_oi_ratio?.toFixed(2) ?? "-"}</strong></div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="label">Skew 30d</span><SkewBar rr={o.rr25_30d} />
                </div>
              </div>
            </section>);
        })}
      </div>
      <p className="status" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Curve compares the longest expiry with the nearest; inverted means short-dated options cost more, usually under stress.
        <Info>Skew is the 25-delta risk reversal at 30 days: below zero, puts are priced richer than calls. Put / call is open interest. On some coins most open interest comes from call-selling vaults, so read it as structure rather than sentiment.</Info>
      </p>
      {coins[0] && <p className="status">Updated {utc(coins[0].options.ts)}</p>}
    </div>
  );
}
