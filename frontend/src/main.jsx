import React, { useEffect, useRef, useState, useId } from "react";
import { createRoot } from "react-dom/client";
import { motion, MotionConfig } from "framer-motion";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Search,
  Star,
  SlidersHorizontal,
  RefreshCw,
  Download,
  X,
  ChevronRight,
  Activity,
  Layers3,
  ScanLine,
  ExternalLink,
  Info,
  Menu,
  Check,
  Radio,
  CircleHelp,
} from "lucide-react";
import initialSignals from "./data/signals.json";
import initialBTC from "./data/btc.json";
import initialETH from "./data/eth.json";
import {
  DATA_ROOT,
  number,
  price,
  percent,
  title,
  timestamp,
  signalLabel,
  change,
  selectRows,
  validateSignals,
  validateSurface,
  csv,
} from "./data";
import "./style.css";

const Button = ({ children, className = "", ...props }) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    className={"button " + className}
    {...props}
  >
    {children}
  </motion.button>
);
const Link = ({ children, className = "", ...props }) => (
  <motion.a
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    className={"button " + className}
    {...props}
  >
    {children}
  </motion.a>
);
const Mark = () => (
  <svg viewBox="0 0 38 32" fill="none" aria-hidden="true">
    <path d="M12 2h25l-5 8H7zM7 13h25l-5 8H15l-5 9H0z" fill="currentColor" />
  </svg>
);
const Brand = () => (
  <a href="#home" className="brand" aria-label="Torq home">
    <Mark />
    <span>torq</span>
  </a>
);
const Coin = ({ symbol }) => (
  <span className={"coin coin-" + symbol.toLowerCase()} aria-hidden="true">
    {{
      BTC: "₿",
      ETH: "♦",
      SOL: "≋",
      HYPE: "H",
      DOGE: "Ð",
      XRP: "X",
      LINK: "⬡",
      BNB: "B",
    }[symbol] || symbol.slice(0, 1)}
  </span>
);
const Tone = ({ row }) => (
  <span
    className={
      "signal " +
      (row.data_status === "not enough data"
        ? "muted"
        : /LONG|ACCUM/.test(row.signal)
          ? "positive"
          : /EXIT|SHORT/.test(row.signal)
            ? "negative"
            : "muted")
    }
  >
    <span className="signal-mark" />
    {signalLabel(row)}
  </span>
);
function Spark({
  values = [],
  large = false,
  color = "var(--orange)",
  label = "Closed-bar price history",
}) {
  const id = useId().replaceAll(":", "");
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return <span className="muted">No history</span>;
  const w = large ? 700 : 130,
    h = large ? 210 : 36,
    p = large ? 12 : 2,
    min = Math.min(...clean),
    max = Math.max(...clean),
    span = max - min || 1;
  const points = clean.map((v, i) => [
    p + (i / (clean.length - 1)) * (w - p * 2),
    p + (1 - (v - min) / span) * (h - p * 2),
  ]);
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={large ? "price-chart" : "spark"}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".18" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {large && (
        <>
          <path d={`${d} L${w - p},${h} L${p},${h}Z`} fill={`url(#${id})`} />
          {[0.2, 0.5, 0.8].map((y) => (
            <line
              key={y}
              x1="0"
              x2={w}
              y1={h * y}
              y2={h * y}
              stroke="#ffffff09"
            />
          ))}
        </>
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={large ? 2 : 1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function Orbit() {
  const paths = [];
  for (let j = 0; j < 54; j++) {
    const v = (j / 54) * Math.PI * 2;
    let d = "";
    for (let i = 0; i <= 170; i++) {
      const u = (i / 170) * Math.PI * 2,
        r = 147 + 56 * Math.cos(v),
        x = r * Math.cos(u),
        y = r * Math.sin(u),
        z = 56 * Math.sin(v);
      const yy = y * 0.63 - z * 0.78,
        zz = y * 0.78 + z * 0.63;
      const a = -0.5,
        xx = x * Math.cos(a) - yy * Math.sin(a),
        yyy = x * Math.sin(a) + yy * Math.cos(a);
      d += `${i ? "L" : "M"}${(260 + xx * (1 + zz / 1500)).toFixed(2)},${(245 + yyy * (1 + zz / 1500)).toFixed(2)} `;
    }
    paths.push(
      <path
        key={j}
        d={d}
        fill="none"
        stroke={j > 26 ? "#ff712f" : "#b7360a"}
        strokeWidth={j > 26 ? 0.9 : 0.65}
        opacity={j > 26 ? 0.8 : 0.34}
      />,
    );
  }
  return (
    <div className="orbit-scene" aria-hidden="true">
      <div className="orbit-glow" />
      <svg className="orbit" viewBox="0 0 520 490">
        <defs>
          <radialGradient id="core">
            <stop stopColor="#fe5100" stopOpacity=".14" />
            <stop offset="1" stopColor="#fe5100" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="260" cy="245" r="220" fill="url(#core)" />
        {paths}
        <ellipse
          cx="260"
          cy="245"
          rx="249"
          ry="204"
          fill="none"
          stroke="#777"
          strokeOpacity=".22"
          strokeDasharray="2 8"
          transform="rotate(-26 260 245)"
        />
        <circle cx="461" cy="105" r="3" fill="#ff5100" />
      </svg>
      <span className="orbit-tag orbit-tag-top">
        <span /> 4H signals
      </span>
      <span className="orbit-tag orbit-tag-bottom">
        <span /> 1D perspective
      </span>
      <div className="orbit-caption">
        Independent signals. Connected markets.
      </div>
    </div>
  );
}
function Modal({ title: heading, children, onClose, wide = false }) {
  const dialog = useRef(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = dialog.current;
    el.showModal();
    const handler = (e) => {
      e.preventDefault();
      closeRef.current();
    };
    el.addEventListener("cancel", handler);
    return () => {
      el.removeEventListener("cancel", handler);
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={heading}
      className={"modal " + (wide ? "wide" : "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2>{heading}</h2>
        <Button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [page, setPage] = useState(location.hash.slice(1) || "home"),
    [menu, setMenu] = useState(false),
    [method, setMethod] = useState(false);
  const [signals, setSignals] = useState(initialSignals),
    [options, setOptions] = useState({ BTC: initialBTC, ETH: initialETH }),
    [loading, setLoading] = useState(false);
  const [sources, setSources] = useState({
      signals: "snapshot",
      BTC: "snapshot",
      ETH: "snapshot",
    }),
    [tf, setTf] = useState("4h"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("market"),
    [direction, setDirection] = useState(1),
    [selected, setSelected] = useState(null),
    [asset, setAsset] = useState("BTC");
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem("torq-watchlist") || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [notice, setNotice] = useState("");
  const refreshLock = useRef(false);
  useEffect(() => {
    const fn = () => {
      setPage(location.hash.slice(1) || "home");
      setMenu(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(id);
    }
  }, [notice]);
  async function refresh() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setLoading(true);
    const paths = [
      "signals/latest.json",
      "v2_mainnet/BTC/latest.json",
      "v2_mainnet/ETH/latest.json",
    ];
    const results = await Promise.allSettled(
      paths.map(async (path, i) => {
        const response = await fetch(DATA_ROOT + path, {
          signal: AbortSignal.timeout(12000),
          cache: "no-cache",
        });
        if (!response.ok) throw new Error("Unavailable");
        return (i === 0 ? validateSignals : validateSurface)(
          await response.json(),
        );
      }),
    );
    const states = {};
    results.forEach((result, i) => {
      const key = ["signals", "BTC", "ETH"][i];
      states[key] = result.status === "fulfilled" ? "connected" : "offline";
      if (result.status === "fulfilled") {
        if (i === 0) setSignals(result.value);
        else setOptions((prev) => ({ ...prev, [key]: result.value }));
      }
    });
    setSources(states);
    setLoading(false);
    refreshLock.current = false;
  }
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 300000);
    return () => clearInterval(id);
  }, []);
  const save = (symbol) => {
    const next = watchlist.includes(symbol)
      ? watchlist.filter((s) => s !== symbol)
      : [...watchlist, symbol];
    setWatchlist(next);
    try {
      localStorage.setItem("torq-watchlist", JSON.stringify(next));
    } catch {
      setNotice("Saved for this session. Browser storage is unavailable.");
    }
  };
  const timeframe = signals.timeframes[tf];
  const rows = selectRows(timeframe.rows, {
    query: ["scanner", "watchlist"].includes(page) ? query : "",
    filter: page === "watchlist" ? "watchlist" : filter,
    watchlist,
    sort,
    direction,
    tf,
  });
  const active = timeframe.rows.filter(
    (r) => r.data_status !== "not enough data" && r.signal !== "WAIT",
  ).length;
  const selectedRow = timeframe.rows.find((r) => r.symbol === selected);
  const isHome = !["scanner", "surface", "watchlist"].includes(page);
  const freshness = (key, ts, limit) =>
    sources[key] === "offline"
      ? "Offline · last saved data"
      : sources[key] === "snapshot"
        ? "Saved snapshot"
        : Date.now() / 1000 - ts > limit
          ? "Delayed snapshot"
          : "Latest published";
  function exportData() {
    const blob = new Blob([csv(rows, tf)], { type: "text/csv;charset=utf-8;" }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `torq-${tf}-${new Date(timeframe.bar_close * 1000).toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV exported for the current view.");
  }
  const setOrder = (key) => {
    if (sort === key) setDirection(-direction);
    else {
      setSort(key);
      setDirection(key === "market" ? 1 : -1);
    }
  };
  function renderScanner({ preview = false } = {}) {
    return (
      <div className={"terminal " + (preview ? "terminal-preview" : "")}>
        <div className="terminal-top">
          <div className="flex items-center gap-3">
            <ScanLine size={17} className="orange" />
            <strong>Market scanner</strong>
            {preview && (
              <span className="muted small desktop-only">
                A little clarity goes a long way.
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="data-label">
              <span className="status-dot" />
              {freshness(
                "signals",
                timeframe.bar_close,
                tf === "4h" ? 15300 : 87300,
              )}
            </span>
            <Button
              className="icon-button"
              aria-label="Refresh market data"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </Button>
          </div>
        </div>
        <div className="terminal-controls">
          <div className="tabs" aria-label="Market filter">
            {[
              ["all", "All markets"],
              ["active", "Active signals"],
              ["watchlist", "Watchlist"],
            ].map(([k, label]) => (
              <Button
                key={k}
                className={
                  ((page === "watchlist" ? "watchlist" : filter) === k
                    ? "selected "
                    : "") + "tab"
                }
                aria-pressed={
                  (page === "watchlist" ? "watchlist" : filter) === k
                }
                onClick={() => {
                  setFilter(k);
                  if (page === "watchlist") location.hash = "scanner";
                }}
              >
                {label}
                {k === "active" && <span className="tab-count">{active}</span>}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-5">
            <div className="tabs time-tabs" aria-label="Signal timeframe">
              {["4h", "1d"].map((t) => (
                <Button
                  key={t}
                  className={"tab " + (tf === t ? "selected" : "")}
                  aria-pressed={tf === t}
                  onClick={() => setTf(t)}
                >
                  {t.toUpperCase()}
                </Button>
              ))}
            </div>
            {!preview && (
              <Button
                className="icon-button"
                onClick={exportData}
                aria-label="Export current view as CSV"
              >
                <Download size={17} />
              </Button>
            )}
          </div>
        </div>
        {!preview && (
          <div className="search-row">
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search markets"
                aria-label="Search markets"
              />
              {query && (
                <Button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </Button>
              )}
            </label>
            <span className="muted small">
              {rows.length} markets <SlidersHorizontal size={14} />
            </span>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="star-cell">
                  <span className="sr-only">Watchlist</span>
                </th>
                <th
                  aria-sort={
                    sort === "market"
                      ? direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => setOrder("market")}>
                    Market{" "}
                    {sort === "market" && (
                      <ArrowDown
                        size={12}
                        style={{
                          transform:
                            direction === 1 ? "rotate(180deg)" : undefined,
                        }}
                      />
                    )}
                  </button>
                </th>
                <th
                  aria-sort={
                    sort === "price"
                      ? direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => setOrder("price")}>
                    Price{" "}
                    {sort === "price" && (
                      <ArrowDown
                        size={12}
                        style={{
                          transform:
                            direction === 1 ? "rotate(180deg)" : undefined,
                        }}
                      />
                    )}
                  </button>
                </th>
                <th
                  aria-sort={
                    sort === "change"
                      ? direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => setOrder("change")}>
                    24h change{" "}
                    {sort === "change" && (
                      <ArrowDown
                        size={12}
                        style={{
                          transform:
                            direction === 1 ? "rotate(180deg)" : undefined,
                        }}
                      />
                    )}
                  </button>
                </th>
                <th>Signal</th>
                <th>Regime</th>
                <th
                  aria-sort={
                    sort === "heat"
                      ? direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => setOrder("heat")}>
                    Heat{" "}
                    {sort === "heat" && (
                      <ArrowDown
                        size={12}
                        style={{
                          transform:
                            direction === 1 ? "rotate(180deg)" : undefined,
                        }}
                      />
                    )}
                  </button>
                </th>
                <th>Last 24 bars</th>
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(preview ? rows.slice(0, 5) : rows).map((r, i) => {
                const c = change(r, tf);
                return (
                  <motion.tr
                    key={r.symbol}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.025, 0.2) }}
                  >
                    <td className="star-cell">
                      <Button
                        className={
                          "icon-button star " +
                          (watchlist.includes(r.symbol) ? "saved" : "")
                        }
                        onClick={() => save(r.symbol)}
                        aria-label={`${watchlist.includes(r.symbol) ? "Remove" : "Save"} ${r.underlying} ${watchlist.includes(r.symbol) ? "from" : "to"} watchlist`}
                        aria-pressed={watchlist.includes(r.symbol)}
                      >
                        <Star
                          size={14}
                          fill={
                            watchlist.includes(r.symbol)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </Button>
                    </td>
                    <td>
                      <button
                        className="market-button"
                        onClick={() => setSelected(r.symbol)}
                      >
                        <Coin symbol={r.underlying} />
                        <span>
                          <b>{r.underlying}</b>
                          <small>Perpetual</small>
                        </span>
                      </button>
                    </td>
                    <td className="numeric">{price(r.price)}</td>
                    <td
                      className={
                        "numeric " + (c >= 0 ? "positive" : "negative")
                      }
                    >
                      {c == null ? "—" : `${c > 0 ? "+" : ""}${number(c)}%`}
                    </td>
                    <td>
                      <Tone row={r} />
                      {r.data_status === "warming up" && (
                        <small className="data-warning">Warming up</small>
                      )}
                    </td>
                    <td className="muted">{title(r.regime)}</td>
                    <td>
                      <span className="heat">
                        <span>
                          {Array.from({ length: 10 }, (_, j) => (
                            <i
                              key={j}
                              style={{
                                background:
                                  j < Math.ceil((r.heat || 0) / 10)
                                    ? "var(--orange)"
                                    : undefined,
                              }}
                            />
                          ))}
                        </span>
                        <b>{r.heat ?? "—"}</b>
                      </span>
                    </td>
                    <td>
                      <Spark
                        values={r.sparkline}
                        color={c >= 0 ? "var(--green)" : "var(--red)"}
                      />
                    </td>
                    <td>
                      <Button
                        className="icon-button"
                        aria-label={`Open ${r.underlying} details`}
                        onClick={() => setSelected(r.symbol)}
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="empty">
            <Search size={26} />
            <h3>{query ? "No markets found" : "Your view is clear"}</h3>
            <p>
              {query
                ? "Try a different symbol or clear your filters."
                : page !== "watchlist" && filter === "active"
                  ? "No active signals on this timeframe."
                  : "Save a market with the star to add it here."}
            </p>
            <Button
              className="secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
                if (page === "watchlist") location.hash = "scanner";
              }}
            >
              Show all markets
            </Button>
          </div>
        )}
        <div className="terminal-foot">
          <span>
            {tf.toUpperCase()} close · {timestamp(timeframe.bar_close)}
          </span>
          {preview ? (
            <a href="#scanner">
              Explore all {timeframe.rows.length} markets{" "}
              <ArrowRight size={14} />
            </a>
          ) : (
            <span>
              Derive index data <span className="divider">/</span> Read only
            </span>
          )}
        </div>
      </div>
    );
  }
  function renderSurface() {
    const o = options[asset],
      f = o.features;
    const points = o.expiries
      .filter((e) => Number.isFinite(e.atm_iv) && e.tenor_days > 0)
      .sort((a, b) => a.tenor_days - b.tenor_days);
    const lo = Math.floor(Math.min(...points.map((p) => p.atm_iv)) * 20) / 20,
      hi = Math.ceil(Math.max(...points.map((p) => p.atm_iv)) * 20) / 20;
    const maxDays = Math.max(...points.map((p) => p.tenor_days), 1);
    const x = (d) => 55 + (Math.log1p(d) / Math.log1p(maxDays)) * 610,
      y = (v) => 220 - ((v - lo) / (hi - lo || 1)) * 175;
    const d = points
      .map((p, i) => `${i ? "L" : "M"}${x(p.tenor_days)},${y(p.atm_iv)}`)
      .join(" ");
    const sd = f.index_price * f.atm_iv_30d * Math.sqrt(30 / 365);
    return (
      <>
        <div className="surface-heading">
          <div>
            <h2>Options surface</h2>
            <p>What the market is pricing. Context, not a signal.</p>
          </div>
          <div className="tabs">
            {["BTC", "ETH"].map((a) => (
              <Button
                key={a}
                className={"tab " + (asset === a ? "selected" : "")}
                onClick={() => setAsset(a)}
                aria-pressed={asset === a}
              >
                {a}
              </Button>
            ))}
          </div>
        </div>
        <div className="surface-grid">
          <div className="surface-chart panel">
            <div className="flex items-center justify-between">
              <h3>Volatility term structure</h3>
              <span className="small muted">ATM implied volatility</span>
            </div>
            {points.length ? (
              <svg
                viewBox="0 0 700 280"
                className="term-chart"
                role="img"
                aria-label={`${asset} implied volatility by days to expiry`}
              >
                <defs>
                  <linearGradient id="term-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop stopColor="#ff5100" stopOpacity=".2" />
                    <stop offset="1" stopColor="#ff5100" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {Array.from(
                  { length: 5 },
                  (_, i) => lo + ((hi - lo) * i) / 4,
                ).map((v, i) => (
                  <g key={i}>
                    <line
                      x1="55"
                      x2="665"
                      y1={y(v)}
                      y2={y(v)}
                      stroke="#ffffff0d"
                    />
                    <text x="8" y={y(v) + 4}>
                      {percent(v)}
                    </text>
                  </g>
                ))}
                {[1, 7, 30, 90, 180, 365]
                  .filter((v) => v <= maxDays * 1.03)
                  .map((v) => (
                    <text key={v} x={x(v)} y="259" textAnchor="middle">
                      {v}d
                    </text>
                  ))}
                <path
                  d={`${d} L${x(points.at(-1).tenor_days)},230 L${x(points[0].tenor_days)},230Z`}
                  fill="url(#term-fill)"
                />
                <path d={d} fill="none" stroke="#ff5100" strokeWidth="2.5" />
                {points.map((p) => (
                  <circle
                    key={p.expiry}
                    cx={x(p.tenor_days)}
                    cy={y(p.atm_iv)}
                    r="4"
                    fill="#17120f"
                    stroke="#ff7c40"
                    strokeWidth="1.5"
                  >
                    <title>
                      {p.tenor_days.toFixed(1)} days: {percent(p.atm_iv)}
                    </title>
                  </circle>
                ))}
              </svg>
            ) : (
              <p className="empty">No volatility quotes available.</p>
            )}
            <div className="chart-foot">
              <span className="orange">— {asset} volatility</span>
              <span>{points.length} quoted expiries</span>
            </div>
          </div>
          <div className="panel surface-metrics">
            <div className="flex items-center gap-3">
              <Coin symbol={asset} />
              <div>
                <strong>{asset}</strong>
                <p className="small muted">{price(f.index_price)} index</p>
              </div>
            </div>
            <div className="metric-grid">
              {[
                ["7d ATM IV", percent(f.atm_iv_7d)],
                ["30d ATM IV", percent(f.atm_iv_30d)],
                ["90d ATM IV", percent(f.atm_iv_90d)],
                [
                  "25-delta skew",
                  Number.isFinite(f.rr25_30d)
                    ? number(f.rr25_30d * 100) + " pp"
                    : "—",
                ],
                ["Put / call OI", number(f.pc_oi_ratio)],
                ["Funding · annual", percent(f.funding_ann)],
              ].map(([l, v]) => (
                <div key={l}>
                  <span>{l}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="range-panel panel">
          <div>
            <h3>
              30-day priced range{" "}
              <Button
                className="inline-info"
                aria-label="About the priced range"
                onClick={() => setMethod(true)}
              >
                <Info size={14} />
              </Button>
            </h3>
            <p className="small muted">Implied by option prices</p>
          </div>
          <div className="range-visual">
            <div className="range-track">
              <span />
              <i />
            </div>
            <div className="flex justify-between numeric small">
              <span>
                {Number.isFinite(sd) ? price(f.index_price - sd) : "—"}
              </span>
              <span className="muted">{price(f.index_price)}</span>
              <span>
                {Number.isFinite(sd) ? price(f.index_price + sd) : "—"}
              </span>
            </div>
          </div>
        </div>
        <p className="surface-stamp">
          {freshness(asset, o.ts, 1800)} · {timestamp(o.ts)} · Recorded every 15
          minutes
        </p>
      </>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main").focus();
          document.getElementById("main").scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <header>
        <div className="shell header-inner">
          <Brand />
          {isHome ? (
            <nav
              aria-label="Main navigation"
              className={menu ? "mobile-open" : ""}
            >
              <a href="#scanner">Scanner</a>
              <a href="#surface">Options surface</a>
              <button onClick={() => setMethod(true)}>
                How it works <ArrowUpRight size={12} />
              </button>
            </nav>
          ) : (
            <nav
              aria-label="App navigation"
              className={menu ? "mobile-open" : ""}
            >
              {[
                ["scanner", "Scanner"],
                ["surface", "Options surface"],
                ["watchlist", "Watchlist"],
              ].map(([p, label]) => (
                <a
                  key={p}
                  className={page === p ? "current" : ""}
                  href={"#" + p}
                >
                  {label}
                </a>
              ))}
            </nav>
          )}
          <div className="header-right">
            {isHome ? (
              <Link href="#scanner" className="primary small-button">
                Launch scanner <ArrowUpRight size={15} />
              </Link>
            ) : (
              <Button
                className="icon-button"
                aria-label="How Torq works"
                onClick={() => setMethod(true)}
              >
                <CircleHelp size={19} />
              </Button>
            )}
            <Button
              className="icon-button menu-button"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X size={20} /> : <Menu size={20} />}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {isHome ? (
          <>
            <section className="hero shell">
              <motion.div
                className="hero-copy"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="hero-kicker">
                  <span className="kicker-line" />A clearer view of Derive
                </div>
                <h1>
                  Less noise.
                  <br />
                  More perspective.
                </h1>
                <p>
                  Perpetual signals. Options intelligence.
                  <br />
                  Your market, brought into focus.
                </p>
                <div className="hero-actions">
                  <Link href="#scanner" className="primary">
                    Launch scanner <ArrowUpRight size={18} />
                  </Link>
                  <Button
                    className="text-button"
                    onClick={() => setMethod(true)}
                  >
                    Explore the engine <ArrowRight size={16} />
                  </Button>
                </div>
                <div className="hero-note">
                  <span className="tiny-cross">+</span> Every market. Every
                  close. No wallet needed.
                </div>
              </motion.div>
              <motion.div
                className="hero-art"
                initial={{ opacity: 0, rotate: -8 }}
                animate={{ opacity: 1, rotate: 0 }}
                transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <Orbit />
              </motion.div>
            </section>
            <div className="shell market-strip">
              <div>
                <span className="strip-label">Built for</span>
                <a
                  href="https://www.derive.xyz/"
                  target="_blank"
                  rel="noreferrer"
                  className="derive-brand"
                >
                  <span className="derive-symbol">▰</span> Derive{" "}
                  <ArrowUpRight size={12} />
                </a>
              </div>
              <div>
                <strong>{timeframe.rows.length}</strong>
                <span>Perpetual markets</span>
              </div>
              <div>
                <strong>
                  4H <span className="muted">/</span> 1D
                </strong>
                <span>Signal timeframes</span>
              </div>
              <div>
                <strong>15 min</strong>
                <span>Options snapshots</span>
              </div>
              <div className="strip-end">
                <Layers3 size={17} />
                <span>
                  Two perspectives.
                  <br />
                  One workspace.
                </span>
              </div>
            </div>
            <section className="shell preview-section">
              <div className="section-heading">
                <div>
                  <span className="section-overline">
                    The market, at a glance
                  </span>
                  <h2>Find your focus.</h2>
                </div>
                <p>
                  See the setup. Read the context.
                  <br />
                  Keep the whole market in view.
                </p>
              </div>
              {renderScanner({ preview: true })}
            </section>
            <section className="shell feature-section">
              <div className="feature-intro">
                <span className="section-overline">A deeper read</span>
                <h2>
                  Price tells a story.
                  <br />
                  Context adds another.
                </h2>
                <p>
                  Connect closed-bar signals with what the options market is
                  pricing.
                </p>
                <Link href="#surface" className="text-button">
                  Explore options <ArrowUpRight size={16} />
                </Link>
              </div>
              <div className="feature-card">
                <div className="feature-card-top">
                  <Activity size={21} />
                  <span>Signals</span>
                  <span className="muted">4H + 1D</span>
                </div>
                <div className="signal-illustration">
                  <span>Price</span>
                  <Spark
                    values={
                      signals.timeframes["4h"].rows.find(
                        (r) => r.underlying === "BTC",
                      )?.sparkline
                    }
                    large
                  />
                  <span className="illustration-note">
                    BTC · last 24 closes
                  </span>
                </div>
                <h3>Every close, a fresh perspective.</h3>
                <p>
                  Momentum, regime and market heat.
                  <br />
                  Reflex’s engines, running on Derive.
                </p>
                <a
                  href="#scanner"
                  className="card-link"
                  aria-label="Explore signals"
                >
                  <ArrowUpRight size={21} />
                </a>
              </div>
              <div className="feature-card options-feature">
                <div className="feature-card-top">
                  <Layers3 size={21} />
                  <span>Options</span>
                  <span className="muted">BTC + ETH</span>
                </div>
                <div className="iv-illustration">
                  <span className="small muted">
                    BTC · 30d implied volatility
                  </span>
                  <strong>{percent(options.BTC.features.atm_iv_30d)}</strong>
                  <div className="iv-bars">
                    {options.BTC.expiries.slice(0, 10).map((p, i) => (
                      <i
                        key={i}
                        style={{
                          height: 20 + p.atm_iv * 100 + "%",
                          opacity: 0.3 + i * 0.065,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <h3>Another dimension of the market.</h3>
                <p>
                  Volatility, skew and open interest.
                  <br />A surface of context, refreshed every 15 minutes.
                </p>
                <a
                  href="#surface"
                  className="card-link"
                  aria-label="Explore options surface"
                >
                  <ArrowUpRight size={21} />
                </a>
              </div>
            </section>
            <section className="shell final-cta">
              <div className="cta-mark">
                <Mark />
              </div>
              <h2>
                Your next session,
                <br />
                with a little more clarity.
              </h2>
              <Link href="#scanner" className="primary">
                Open your workspace <ArrowUpRight size={18} />
              </Link>
              <p>No sign-up. No wallet. Just the market.</p>
            </section>
          </>
        ) : (
          <div className="shell workspace">
            <div className="workspace-title">
              <div>
                <div className="breadcrumb">
                  Workspace <ChevronRight size={12} />{" "}
                  {page === "surface"
                    ? "Options"
                    : page === "watchlist"
                      ? "Watchlist"
                      : "Overview"}
                </div>
                <h1>
                  {page === "surface"
                    ? "Another dimension."
                    : page === "watchlist"
                      ? "Your market view."
                      : "Market overview."}
                </h1>
                <p>
                  {page === "surface"
                    ? "Volatility, skew and positioning across Derive options."
                    : "Every Derive perpetual. One clear perspective."}
                </p>
              </div>
              <Button
                className="secondary refresh-button"
                disabled={loading}
                onClick={refresh}
              >
                <RefreshCw size={15} className={loading ? "spin" : ""} />
                {loading ? "Refreshing…" : "Refresh data"}
              </Button>
            </div>
            {page === "surface" ? (
              renderSurface()
            ) : (
              <>
                <div className="overview-grid">
                  <div>
                    <span>Markets scanned</span>
                    <strong>
                      {timeframe.rows.length}
                      <small> perpetuals</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      Active signals{" "}
                      <Button
                        className="inline-info"
                        aria-label="About signals"
                        onClick={() => setMethod(true)}
                      >
                        <Info size={13} />
                      </Button>
                    </span>
                    <strong>
                      {active}
                      <small> on {tf.toUpperCase()}</small>
                    </strong>
                  </div>
                  <div>
                    <span>Market regime</span>
                    <strong className="regime-summary">
                      {title(timeframe.consensus?.consensus)}
                    </strong>
                  </div>
                  <div>
                    <span>BTC dominance</span>
                    <strong>
                      {number(
                        signals.context?.global_metrics?.btc_dominance,
                        1,
                      )}
                      <small>%</small>
                    </strong>
                  </div>
                </div>
                {renderScanner()}
                <div className="workspace-bottom">
                  <span>
                    <Info size={14} /> Signals use closed bars. Options provide
                    context.
                  </span>
                  <button onClick={() => setMethod(true)}>
                    Understand the data <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
      <footer className="shell">
        <Brand />
        <span>Independent perspective. Built on Derive.</span>
        <div>
          <button onClick={() => setMethod(true)}>Methodology</button>
          <a
            href="https://github.com/cianfru/derive_scan"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ArrowUpRight size={12} />
          </a>
        </div>
        <p>
          Market research, not investment advice. Torq is an independent
          project.
        </p>
      </footer>
      {selectedRow && (
        <Modal
          title={selectedRow.underlying + " perpetual"}
          wide
          onClose={() => setSelected(null)}
        >
          <div className="detail-price">
            <div>
              <span className="muted small">
                Derive index · {tf.toUpperCase()} close
              </span>
              <strong>{price(selectedRow.price)}</strong>
            </div>
            <Tone row={selectedRow} />
          </div>
          <Spark values={selectedRow.sparkline} large />
          <div className="chart-foot">
            <span>Last 24 closed bars · {tf.toUpperCase()}</span>
            <span>{timestamp(timeframe.bar_close)}</span>
          </div>
          <div className="detail-grid">
            {[
              ["Regime", title(selectedRow.regime)],
              [
                "Combined 4H + 1D",
                selectedRow.data_status === "not enough data"
                  ? "Insufficient data"
                  : title(selectedRow.unified_signal),
              ],
              ["Z-score", number(selectedRow.zscore)],
              ["Heat", `${selectedRow.heat} / 100`],
              ["Data", title(selectedRow.data_status)],
              ["Volume", title(selectedRow.volume_status)],
            ].map(([l, v]) => (
              <div key={l}>
                <span>{l}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <p className="detail-note">
            {selectedRow.data_status === "not enough data"
              ? "There is not enough closed-bar history for a reliable signal."
              : selectedRow.data_status === "warming up"
                ? "The engine is warming up. Z-scores are damped until more history is available."
                : "Signals are computed after each candle closes."}
            {selectedRow.volume_status === "thin"
              ? " Thin volume: volume-based exhaustion flags are disabled."
              : ""}
          </p>
          <Button
            className="secondary"
            onClick={() => save(selectedRow.symbol)}
          >
            {watchlist.includes(selectedRow.symbol) ? (
              <Check size={16} />
            ) : (
              <Star size={16} />
            )}{" "}
            {watchlist.includes(selectedRow.symbol)
              ? "Saved to watchlist"
              : "Save to watchlist"}
          </Button>
        </Modal>
      )}
      {method && (
        <Modal title="Behind the perspective" onClose={() => setMethod(false)}>
          <p className="modal-intro">
            Two views of the same market, in one workspace.
          </p>
          <div className="method-row">
            <ScanLine />
            <div>
              <h3>Signals on closed bars</h3>
              <p>
                Reflex’s signal engines run on Derive index candles after every
                4H and daily close. Combined signals bring both timeframes
                together. Price and 24h change are measured at the selected
                candle close.
              </p>
            </div>
          </div>
          <div className="method-row">
            <Layers3 />
            <div>
              <h3>Options as context</h3>
              <p>
                BTC and ETH snapshots record volatility, 25-delta skew and open
                interest every 15 minutes. The priced range is index price ± 30d
                ATM IV × index price × √(30/365). It describes option pricing;
                it is not a forecast.
              </p>
            </div>
          </div>
          <div className="method-row">
            <Radio />
            <div>
              <h3>Know the data</h3>
              <p>
                Saved snapshots remain visible if the feed is unavailable, with
                their original timestamp. Insufficient history and thin volume
                are marked in market details. Watchlists stay in this browser.
                No orders are placed.
              </p>
            </div>
          </div>
          <a
            className="method-source"
            href="https://github.com/cianfru/derive_scan#readme"
            target="_blank"
            rel="noreferrer"
          >
            Read the full methodology <ExternalLink size={14} />
          </a>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </MotionConfig>
  );
}
createRoot(document.getElementById("root")).render(<App />);
