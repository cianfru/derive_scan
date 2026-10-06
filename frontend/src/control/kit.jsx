// Shared pieces for the X cards: formatting, the 1080x1080 frame, a flowing layout, charts and tiles.
import { codename } from "../lib/walletName.js";
import { walletAvatar } from "../lib/walletAvatar.js";
import { HAT_ICON } from "../components/Brand.jsx";

export const TAG = "@derivexyz";
export const NAME = { ADA: "Cardano", BTC: "Bitcoin", CC: "Canton", ETH: "Ethereum", HYPE: "Hyperliquid", LIT: "Lighter", PUMP: "Pump", SOL: "Solana", VVV: "Venice", XAUT: "Tether Gold", XRP: "XRP", ZEC: "Zcash", BNB: "BNB", DOGE: "Dogecoin", LINK: "Chainlink" };
export const REG = { MARKUP: "Trending up", REACC: "Cooling off", ACCUM: "Building a base", MARKDOWN: "Trending down", BLOWOFF: "Overheated", CAP: "Washed out", FLAT: "No reading yet" };
export const REG_COLOR = { MARKUP: "#8ff0c6", REACC: "#93ad88", ACCUM: "#c4b17b", MARKDOWN: "#ff9d90", BLOWOFF: "#e0a050", CAP: "#b35c52", FLAT: "#6d675f" };
const ICON = { CC: "CC.png", HYPE: "HYPE.jpg", LIT: "LIT.png", PUMP: "PUMP.jpg", VVV: "VVV.png" };
export const icon = (und) => `/coins/${ICON[und] || und + ".svg"}`;
export const UP = "#8ff0c6", DOWN = "#ff9d90", GREY = "#8a847b", INK = "#f7f3ed", MUTED = "#b9b0a4";

const num = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const k = (v) => `$${num(v / 1000, 1)}k`;
export const usd = (v) => `$${num(Math.round(v))}`;
export const price = (v) => (v >= 1000 ? usd(v) : v >= 10 ? `$${num(v, 2)}` : `$${num(v, 3)}`);
export const big = (v) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${num(a / 1e9, 1)}B`;
  if (a >= 1e6) return `${s}$${num(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${s}$${num(a / 1e3, 0)}K`;
  return `${s}$${num(a)}`;
};
/** A level or price at the right grain: $84.5k for big prices, $2,714 for mid, $93.33 for small. */
export const kk = (v) => (Math.abs(v) >= 20000 ? k(v) : Math.abs(v) >= 1000 ? usd(v) : price(v));
export const strikeLabel = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : `${+v.toFixed(2)}`);
export const cents = (p) => `${Math.round(p * 100)}¢`;
export const pct = (v, d = 1) => `${v >= 0 ? "+" : ""}${num(v, d)}%`;
export const utc = (t, opts) => new Date(t * 1000).toLocaleString("en-GB", { timeZone: "UTC", ...opts });
export const dm = (t) => utc(t, { day: "numeric", month: "short" });
export const weekday = (t) => utc(t, { weekday: "long" });
export const wd = (t) => utc(t, { weekday: "short" });
export const stamp = (src, t) => `${src} · ${dm(t)}, ${utc(t, { hour: "2-digit", minute: "2-digit", hour12: false })} UTC`;
export const join = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** "a BTC drop", "an ETH drop". */
export const an = (und) => (["ETH", "XRP", "ADA", "XAUT"].includes(und) ? "an" : "a");
/** "a week ago" when the point is that old, otherwise its date. */
export const agoText = (ts, now) => (now - ts >= 6.5 * 86400 ? "a week ago" : `on ${new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })}`);
export const fin = (v) => typeof v === "number" && Number.isFinite(v);
export { codename };

const GLOWS = {
  up: ["rgba(80,200,150,.34)", "rgba(80,200,150,.14)"],
  down: ["rgba(240,110,95,.30)", "rgba(240,110,95,.16)"],
  mixed: ["rgba(80,200,150,.30)", "rgba(240,110,95,.26)"],
  calm: ["rgba(120,150,210,.24)", "rgba(200,160,90,.16)"],
};

export function Frame({ kind = "flow", glow = "mixed", stampText, foot = "Not investment advice", children }) {
  const [a, b] = GLOWS[glow] || GLOWS.mixed;
  return (
    <div className={`xc xc-${kind}`} style={{ "--glow-a": a, "--glow-b": b }}>
      <div className="grain" />
      <div className="frame" />
      <div className="top"><img src="/brand/cowboy-lockup-on-dark.svg" alt="Cowboy" /><span className="stamp">{stampText}</span></div>
      {children}
      <div className="foot"><span><b>cowboy.trading</b></span><span>{foot}</span></div>
    </div>
  );
}

/** The flowing card: eyebrow, headline, one line of why, then the visual and up to three tiles. */
export function Card({ glow, stampText, foot, eyebrow, title, sub, tiles, size = "l", children }) {
  return (
    <Frame glow={glow} stampText={stampText} foot={foot}>
      <div className="xf">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className={`h-${size}`}>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
        <div className="main">{children}</div>
        {tiles?.length ? (
          <div className="tiles" style={{ gridTemplateColumns: `repeat(${tiles.length}, 1fr)` }}>
            {tiles.map((t, i) => (
              <div key={i} className={`tile glass${t.tone ? " " + t.tone : ""}`}><b className={t.mono === false ? "w" : ""}>{t.big}</b><span>{t.text}</span></div>
            ))}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

export const AX = { fill: MUTED, fontFamily: "Chivo Mono", fontSize: 15 };
const LABEL = { fontFamily: "Chivo Mono", fontSize: 19, fontWeight: 700, letterSpacing: "-0.03em" };

/** A line chart drawn into a fixed box: series [{pts:[[x,y]], color, width, area, dash}], y labels on the right. */
export function LineChart({ w = 964, h = 380, series, yFmt = (v) => v, yTicks = 4, xLabels = [], zero = null, marks = [], pad = 0.08, yMin, yMax, id = "lc" }) {
  const xs = series.flatMap((s) => s.pts.map((p) => p[0]));
  const ys = series.flatMap((s) => s.pts.map((p) => p[1])).concat(zero != null ? [zero] : []);
  let lo = yMin ?? Math.min(...ys), hi = yMax ?? Math.max(...ys);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * pad; hi += span * pad;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const L = 6, R = w - 110, T = 26, B = h - 40;
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (R - L);
  const Y = (y) => B - ((y - lo) / (hi - lo)) * (B - T);
  const d = (pts) => "M" + pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" L");
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + span * pad + (span * i) / yTicks);
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}-a${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".28" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}
        <filter id={`${id}-glow`} x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}><line x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,.07)" /><text x={R + 14} y={Y(t) + 5} {...AX}>{yFmt(t)}</text></g>
      ))}
      {zero != null ? <line x1={L} x2={R} y1={Y(zero)} y2={Y(zero)} stroke="rgba(255,255,255,.35)" strokeDasharray="4 6" /> : null}
      {series.map((s, i) => (
        <g key={i}>
          {s.area ? <path d={`${d(s.pts)} L${X(s.pts.at(-1)[0])},${B} L${X(s.pts[0][0])},${B} Z`} fill={`url(#${id}-a${i})`} /> : null}
          {s.glow !== false ? <path d={d(s.pts)} fill="none" stroke={s.color} strokeWidth={(s.width || 3) * 2.4} opacity=".3" filter={`url(#${id}-glow)`} /> : null}
          <path d={d(s.pts)} fill="none" stroke={s.color} strokeWidth={s.width || 3} strokeDasharray={s.dash || undefined} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {xLabels.map(([x, label], i) => <text key={i} x={X(x)} y={h - 8} {...AX} textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}>{label}</text>)}
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={X(m.x)} cy={Y(m.y)} r="13" fill={m.color || INK} opacity=".18" />
          <circle cx={X(m.x)} cy={Y(m.y)} r="6.5" fill={m.color || INK} />
          {m.label ? <text x={X(m.x) + (m.dx ?? -14)} y={Y(m.y) + (m.dy ?? -20)} {...LABEL} fill={m.color || INK} textAnchor={m.anchor || "end"}>{m.label}</text> : null}
        </g>
      ))}
    </svg>
  );
}

/** Horizontal bars, one row each: [{label, sub, value, color, text, icon}] scaled to the largest absolute value. */
export function Bars({ rows, signed = false, unit = (v) => v }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div className={`xbars${signed ? " signed" : ""}`}>
      {rows.map((r, i) => {
        const w = (Math.abs(r.value) / max) * (signed ? 50 : 100);
        const color = r.color || (r.value >= 0 ? UP : DOWN);
        return (
          <div key={i} className="xbar">
            <div className="xbar-l">{r.icon ? <img src={r.icon} alt="" /> : null}<span><b>{r.label}</b>{r.sub ? <small>{r.sub}</small> : null}</span></div>
            <div className="xbar-t">
              {signed ? <i className="axis" /> : null}
              <i className="fill" style={{ width: `${w}%`, left: signed ? (r.value >= 0 ? "50%" : `${50 - w}%`) : 0, background: `linear-gradient(90deg, ${color}33, ${color}aa)`, boxShadow: `0 0 18px ${color}33` }} />
            </div>
            <div className="xbar-v" style={{ color }}>{r.text ?? unit(r.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Avatar({ address, size = 44 }) {
  const s = walletAvatar(address);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="14" fill={s.background} stroke={s.dark} strokeOpacity=".25" strokeWidth="2" />
      <path d={HAT_ICON} transform="translate(5 5) scale(.84)" fill="none" stroke={s.dark} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The share of the last n values (excluding the latest) that the latest is above. */
export function rankShare(values) {
  const xs = values.filter(fin);
  if (xs.length < 5) return null;
  const last = xs.at(-1);
  return Math.round((xs.slice(0, -1).filter((v) => v < last).length / (xs.length - 1)) * 100);
}

/** [[ts, v]] averaged per hour, so a 15-minute series reads as a line rather than noise. */
export function hourly(pts, step = 3600) {
  const by = new Map();
  for (const [t, v] of pts) { const h = Math.floor(t / step) * step; const c = by.get(h) || [0, 0]; by.set(h, [c[0] + v, c[1] + 1]); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, [sum, n]]) => [t, sum / n]);
}

/** The value closest to `ago` seconds before the last point of [[ts, v]]. */
export function valueAgo(pts, ago) {
  if (!pts.length) return null;
  const want = pts.at(-1)[0] - ago;
  return pts.reduce((best, p) => (Math.abs(p[0] - want) < Math.abs(best[0] - want) ? p : best), pts[0]);
}
