import { Component, lazy, useEffect, useRef, useState, Suspense } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { Loading } from "./ui.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { Lockup, HatMark } from "./Brand.jsx";
import NavMenu, { MySpace } from "./NavMenu.jsx";
import { QUESTIONS_ON, TESTNET_FILLS } from "../lib/flags.js";
import "../marketplace.css";
import walletCss from "../hdr-wallet.css?inline";

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark",
  );
  const effective = theme;
  const toggle = () => {
    const next = effective === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cowboy-theme", next);
    } catch {
      /* storage may be blocked */
    }
    setTheme(next);
  };
  return [effective, toggle];
}

const RESEARCH = [["/markets", "Markets"], ["/radar", "Radar"], ["/options", "Options"], ["/traders", "Traders"], ["/flow", "Flow"]];
/** Research covers its five pages and the pages they open (a coin, a trader). */
export const isResearch = (path) => RESEARCH.some(([to]) => path === to || path.startsWith(`${to}/`))
  || path.startsWith("/coin/") || path.startsWith("/trader/");

/** With the Saloon on: Markets and Traders, each a menu of its pages, after the Saloon. */
export const MENUS = [
  { id: "markets", label: "Markets", items: [["/markets", "Board"], ["/radar", "Radar"], ["/options", "Options"], ["/flow", "Flow"]],
    owns: (p) => ["/markets", "/radar", "/options", "/flow"].some((to) => p === to || p.startsWith(`${to}/`)) || p.startsWith("/coin/") },
  { id: "traders", label: "Traders", items: [["/traders", "Leaderboard"], ["/traders/cohorts", "Cohorts"]],
    owns: (p) => p === "/traders" || p.startsWith("/traders/") || p.startsWith("/trader/") },
];

// Saloon builds only: "My space" (Positions and Following). The menu shows at once; its counts read
// the browser's records from their own chunk and fill in when it arrives, without remounting the menu.
const MySpaceCounts = QUESTIONS_ON ? lazy(() => import("./MySpace.jsx")) : null;

// Testnet builds only: the wallet in the header. Its code is the trade chunk's (loaded lazily, so other
// builds carry none of it) and its styles are inlined here, so the header keeps its shape while that
// chunk loads. Every piece sits behind TESTNET_FILLS, which drops it from other builds.
const WalletMenu = TESTNET_FILLS ? lazy(() => import("./trade/TradePanel.jsx").then((m) => ({ default: m.WalletMenu }))) : null;
const QuietBoundary = TESTNET_FILLS ? class extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
} : null;

/** The wallet this browser connected before (lib/trade/store.js KEYS.lastWallet), read without the trade chunk. */
const LAST_WALLET_KEY = TESTNET_FILLS ? "cowboy-saloon-wallet:testnet" : null;
function remembersWallet() {
  try { return !!globalThis.window?.ethereum && !!globalThis.localStorage?.getItem(LAST_WALLET_KEY); } catch { return false; }
}

/**
 * "Connect wallet" until the trade chunk arrives; a tap before then connects once it has. With a
 * remembered wallet it reads "Reconnecting…" instead, while the chunk resumes it quietly.
 */
function HeaderWallet() {
  const early = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [resuming] = useState(remembersWallet);
  const slot = resuming ? (
    <div className="hw">
      <button type="button" className="btn hw-btn" aria-label="Reconnecting" aria-disabled="true">Reconnecting…</button>
    </div>
  ) : (
    <div className="hw">
      <button type="button" className="btn hw-btn" aria-label={waiting ? "Connecting" : "Connect wallet"} aria-disabled={waiting || undefined}
        onClick={() => { early.current = true; setWaiting(true); }}>
        {waiting ? "Connecting…" : <><span className="hw-long">Connect wallet</span><span className="hw-short" aria-hidden="true">Connect</span></>}
      </button>
    </div>
  );
  return (
    <>
      <style>{walletCss}</style>
      <QuietBoundary><Suspense fallback={slot}><WalletMenu early={early} /></Suspense></QuietBoundary>
    </>
  );
}

export default function Shell() {
  const [theme, toggle] = useTheme();
  const { pathname, hash } = useLocation();
  const header = useRef(null);
  const [space, setSpace] = useState(null);
  const saloonActive = pathname !== "/saloon/mine" && pathname !== "/saloon/following" && (pathname.startsWith("/saloon") || pathname.startsWith("/q/"));
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  // Sticky elements sit under the header: its height is published as --header-h.
  useEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className={`hdr${QUESTIONS_ON ? " hdr-marketplace" : ""}${QUESTIONS_ON && pathname === "/" ? " hdr-landing" : ""}${TESTNET_FILLS ? " hdr-wallet" : ""}`} ref={header}>
        <div className="wrap">
          {TESTNET_FILLS ? (
            // Testnet builds only: one-tap trades go to Derive's testnet. Styled inline, and written as a
            // separate branch, so other builds stay byte-identical.
            <Link to="/" className="logo" aria-label="Cowboy home, testnet build">
              <Lockup />
              <span className="hdr-testnet mono" title="One-tap trades in this build go to Derive's testnet with test USDC. Board prices come from Derive's live market."
                style={{ marginLeft: 10, padding: "1px 6px", fontSize: 11, lineHeight: "16px", letterSpacing: ".04em", textTransform: "uppercase",
                  color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 4, whiteSpace: "nowrap" }}>Testnet</span>
            </Link>
          ) : (
            <Link to="/" className="logo" aria-label="Cowboy home">
              <Lockup />
            </Link>
          )}
          {QUESTIONS_ON ? (
            // Outcomes first; the research pages sit in two menus, Markets and Traders, on every screen
            // size. My space (Positions, Following) sits on the right, beside the tools.
            <nav aria-label="Main navigation" className="nav-saloon">
              <Link to="/saloon" className={`nav-primary${saloonActive ? " active" : ""}`} aria-current={saloonActive ? "page" : undefined}>
                <HatMark size={18} />Saloon<span className="nav-sub">Price outcomes</span>
              </Link>
              {MENUS.map((m) => <NavMenu key={m.id} id={m.id} label={m.label} items={m.items.map(([to, text]) => ({ to, text }))} active={m.owns(pathname)} />)}
            </nav>
          ) : (
            <nav aria-label="Main navigation">
              {RESEARCH.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
            </nav>
          )}
          <div className="tools">
            {QUESTIONS_ON && <MySpace positions={space?.positions} following={space?.following} counted={!!space} />}
            {QUESTIONS_ON && <Suspense fallback={null}><MySpaceCounts onCounts={setSpace} /></Suspense>}
            {TESTNET_FILLS && <HeaderWallet />}
            <button
              className="icon-btn"
              onClick={toggle}
              aria-label="Switch light or dark"
            >
              {theme === "dark" ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex="-1">
        <ErrorBoundary key={pathname}>
          <Suspense
            fallback={
              <div className="wrap page">
                <Loading />
              </div>
            }
          >
            <Outlet context={{ theme }} />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="foot">
        <div className="wrap">
          <Link to="/" className="foot-brand" aria-label="Cowboy home"><Lockup /></Link>
          <span className="foot-note">
            <span>Cowboy is independent and built on Derive's public data. Not affiliated with Derive.</span>
            <span>Market data and positioning for research. Not investment advice.</span>
          </span>
          <a href="https://www.derive.xyz/" target="_blank" rel="noreferrer">
            Visit Derive ↗
          </a>
        </div>
      </footer>
    </>
  );
}

export { useTheme };
