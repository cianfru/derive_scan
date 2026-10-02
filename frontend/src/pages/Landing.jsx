import { Link, useOutletContext } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, pct, usd, title, ago, signalTone } from "../lib/format.js";
import { Signal } from "../components/ui.jsx";
import { Logo } from "../components/Shell.jsx";

const TONE = { strong: "var(--sig-strong)", long: "var(--sig-long)", acc: "var(--sig-acc)", wait: "var(--seam-hi)", exit: "var(--sig-exit)", na: "var(--seam)" };

/** A machined gauge: one segment per coin, outer ring 4H, inner ring 1D. */
function Gauge({ coins }) {
  const S = 420, C = S / 2, n = coins.length || 1, gap = 0.045;
  const arc = (r, a0, a1) => {
    const p = (a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const btc = coins.find((c) => c.und === "BTC");
  return (
    <svg className="viz" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Signals on every Derive coin with options: outer ring 4H, inner ring 1D">
      <defs>
        <radialGradient id="face" cx="50%" cy="45%" r="60%"><stop offset="0" stopColor="var(--plate-3)" /><stop offset="1" stopColor="var(--plate)" /></radialGradient>
      </defs>
      <circle cx={C} cy={C} r={C - 4} fill="url(#face)" stroke="var(--seam-hi)" strokeWidth="2" />
      {Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2, r1 = C - 10, r2 = r1 - (i % 5 ? 6 : 14);
        return <line key={i} x1={C + r1 * Math.cos(a)} y1={C + r1 * Math.sin(a)} x2={C + r2 * Math.cos(a)} y2={C + r2 * Math.sin(a)} stroke="var(--seam-hi)" strokeWidth={i % 5 ? 1 : 2} />;
      })}
      {coins.map((c, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + gap / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - gap / 2, am = (a0 + a1) / 2;
        const dim = c.data_4h === "not enough data" ? 0.35 : 1;
        const lr = C - 46, lower = Math.sin(am) > 0.05;
        return (
          <g key={c.und} opacity={dim}>
            <path d={arc(C * 0.66, a0, a1)} stroke={TONE[signalTone(c.signal_4h)]} strokeWidth="24" fill="none" />
            <path d={arc(C * 0.52, a0, a1)} stroke={TONE[signalTone(c.signal_1d)]} strokeWidth="14" fill="none" />
            <text x={C + lr * Math.cos(am)} y={C + lr * Math.sin(am)} textAnchor="middle" dominantBaseline="middle"
              transform={`rotate(${(am * 180) / Math.PI + (lower ? -90 : 90)} ${C + lr * Math.cos(am)} ${C + lr * Math.sin(am)})`}
              style={{ font: "600 11px var(--font-display)", fill: "var(--fg-2)", letterSpacing: ".06em" }}>{c.und}</text>
          </g>);
      })}
      <circle cx={C} cy={C} r={C * 0.4} fill="var(--bg-deep)" stroke="var(--seam-hi)" />
      {btc && (() => {
        const z = Math.max(-3, Math.min(3, btc.z_4h || 0)), a = -Math.PI / 2 + (z / 3) * Math.PI * 0.75;
        return <line x1={C} y1={C} x2={C + Math.cos(a) * C * 0.36} y2={C + Math.sin(a) * C * 0.36} stroke="var(--orange)" strokeWidth="4" strokeLinecap="square" />;
      })()}
      <circle cx={C} cy={C} r="9" fill="var(--plate-3)" stroke="var(--orange)" strokeWidth="2" />
      <text x={C} y={C + 34} textAnchor="middle" style={{ font: "600 10px var(--font-display)", letterSpacing: ".14em", fill: "var(--muted)" }}>BTC Z-SCORE</text>
    </svg>
  );
}

function MiniTerm({ term }) {
  if (!term || term.length < 2) return null;
  const W = 260, H = 70, lt = (d) => Math.log(1 + d), tmax = Math.max(...term.map((t) => t[0]));
  const ivs = term.map((t) => t[1]), lo = Math.min(...ivs), hi = Math.max(...ivs), r = hi - lo || 0.01;
  const pts = term.map((t) => [4 + (lt(t[0]) / lt(tmax)) * (W - 8), 8 + (1 - (t[1] - lo) / r) * (H - 16)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={`${d}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`} fill="var(--orange-glow)" /><path d={d} fill="none" stroke="var(--orange)" strokeWidth="2.2" /></svg>;
}

export default function Landing() {
  const { theme } = useOutletContext();
  const { data } = useData("markets.json");
  const { data: flow } = useData("flow.json");
  const coins = (data?.coins || []).filter((c) => c.has_options);
  const btc = coins.find((c) => c.und === "BTC");
  const withOptions = coins.filter((c) => c.options && c.options.term?.length > 1)
    .sort((a, b) => b.options.option_oi_contracts * (b.price || 0) - a.options.option_oi_contracts * (a.price || 0));
  const topSignals = [...coins].filter((c) => c.data_4h !== "not enough data").sort((a, b) => (b.oi_usd || 0) - (a.oi_usd || 0)).slice(0, 5);
  const biggest = flow?.large?.length ? [...flow.large].sort((a, b) => b.notional_usd - a.notional_usd)[0] : null;
  return (
    <div className="landing">
      <section className="wrap hero">
        <div className="hero-copy">
          <h1 className="sr-only">Torq</h1>
          <Logo theme={theme} height={92} />
          <p className="hero-line">Direction from the engine. Positioning from options.<br /><b>Side by side, for every coin with options on Derive.</b></p>
          <div className="hero-cta">
            <Link className="btn primary" to="/markets">Open markets</Link>
            <Link className="btn" to="/options">Options</Link>
          </div>
          <div className="strip">
            <div><span>BTC</span><strong className="mono">{btc ? price(btc.price) : "-"}</strong></div>
            <div><span>BTC 1D</span><Signal s={btc?.signal_1d} /></div>
            <div><span>Consensus</span><strong>{title(data?.consensus?.["4h"])}</strong></div>
            <div><span>Coins</span><strong className="mono">{coins.length || "-"}</strong></div>
            <div><span>Updated</span><strong className="mono">{data ? ago(data.generated_at) : "-"}</strong></div>
          </div>
        </div>
        <div className="hero-gauge">
          {coins.length ? <Gauge coins={coins} /> : <div className="loading"><div className="spin" /></div>}
          <div className="legend">
            <span><i style={{ background: "var(--sig-strong)" }} />Strong long</span>
            <span><i style={{ background: "var(--sig-long)" }} />Long</span>
            <span><i style={{ background: "var(--sig-acc)" }} />Accumulate</span>
            <span><i style={{ background: "var(--seam-hi)" }} />Wait</span>
            <span><i style={{ background: "var(--sig-exit)" }} />Exit</span>
          </div>
        </div>
      </section>

      <section className="wrap features">
        <article className="plate feature">
          <div className="plate-b">
            <span className="label"><i className="tick" />Signals</span>
            <h2>Every close, every horizon</h2>
            <p className="dim">A regime engine reads each market after every 4-hour and daily close, then sits beside what option prices and the best options traders show for the next 7 and 30 days.</p>
            <ul className="mini-list">
              {topSignals.map((c) => (
                <li key={c.und}><Link to={`/coin/${c.und}`}><b>{c.und}</b><Signal s={c.signal_4h} /><Signal s={c.signal_1d} /></Link></li>))}
            </ul>
            <Link className="more" to="/markets">All markets</Link>
          </div>
        </article>
        <article className="plate feature">
          <div className="plate-b">
            <span className="label"><i className="tick" />Options</span>
            <h2>The options market, made visual</h2>
            <p className="dim">Where open interest sits, what protection costs and how volatility is priced across expiries, for every coin with options on Derive.</p>
            {withOptions.slice(0, 2).map((c) => (
              <div key={c.und} className="mini-opt">
                <div><b>{c.und}</b><span className="mono dim">IV 30d {pct(c.options.atm_iv_30d)}</span></div>
                <MiniTerm term={c.options.term} />
              </div>))}
            <Link className="more" to="/options">Options overview</Link>
          </div>
        </article>
        <article className="plate feature">
          <div className="plate-b">
            <span className="label"><i className="tick" />Flow</span>
            <h2>Who is trading, and how big</h2>
            <p className="dim">Derive's trades are public. Torq ranks options traders by results, leaves market makers out and shows what the best ones hold.</p>
            <div className="flow-figs">
              <div><span>Large trades 24h</span><strong className="mono">{flow?.large?.length ?? "-"}</strong></div>
              <div><span>Largest</span><strong className="mono">{biggest ? usd(biggest.notional_usd) : "-"}</strong>{biggest && <small className="dim">{biggest.instrument}</small>}</div>
            </div>
            <Link className="more" to="/flow">Open flow</Link>
          </div>
        </article>
      </section>

      <section className="wrap steps-sec">
        <span className="label"><i className="tick" />How it works</span>
        <ol className="steps">
          <li><b>Read</b><span>Derive's index, perp volume, funding, open interest and the full options chain.</span></li>
          <li><b>Measure</b><span>Regime and z-score, structural heat, exhaustion, trend ribbon.</span></li>
          <li><b>Align</b><span>Engine, option prices and smart wallets, read side by side for the next 7 and 30 days.</span></li>
          <li><b>Publish</b><span>Fetched once, served to everyone, refreshed every 15 minutes.</span></li>
        </ol>
      </section>
    </div>
  );
}
