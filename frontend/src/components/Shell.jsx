import { useEffect, useRef, useState, Suspense } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { Loading } from "./ui.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { Lockup, HatMark } from "./Brand.jsx";
import { QUESTIONS_ON } from "../lib/flags.js";

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

/** Phones: Research as one menu button. Escape or a pick closes it and focus returns to the button. */
function ResearchMenu({ active }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const menu = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector("a")?.focus();
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); } };
    const away = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", away); };
  }, [open]);
  return (
    <div className="nav-more">
      <button ref={btn} className={`nav-more-btn${active ? " active" : ""}`} aria-expanded={open} aria-controls="research-menu"
        onClick={() => setOpen((o) => !o)}>
        Research<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
      </button>
      {open && (
        <div id="research-menu" ref={menu} className="nav-menu" role="group" aria-label="Research pages">
          {RESEARCH.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </div>
      )}
    </div>
  );
}

export default function Shell() {
  const [theme, toggle] = useTheme();
  const { pathname, hash } = useLocation();
  const header = useRef(null);
  const positionsActive = pathname === "/saloon/mine";
  const saloonActive = !positionsActive && (pathname.startsWith("/saloon") || pathname.startsWith("/q/"));
  const researchActive = isResearch(pathname);
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
      <header className="hdr" ref={header}>
        <div className="wrap">
          <Link to="/" className="logo" aria-label="Cowboy home">
            <Lockup />
          </Link>
          {QUESTIONS_ON ? (
            // Trade, Positions, Research: the Saloon leads; the research pages sit inline after a
            // divider on wide screens and in a Research menu on phones.
            <nav aria-label="Main navigation" className="nav-saloon">
              <Link to="/saloon" className={`nav-primary${saloonActive ? " active" : ""}`} aria-current={saloonActive ? "page" : undefined}>
                <HatMark size={18} />Saloon<span className="nav-sub">Price outcomes</span>
              </Link>
              <Link to="/saloon/mine" className={`nav-positions${positionsActive ? " active" : ""}`} aria-current={positionsActive ? "page" : undefined}>Positions</Link>
              <span className="nav-divider" aria-hidden="true" />
              <div className="nav-research" role="group" aria-label="Research">
                {RESEARCH.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
              </div>
              <ResearchMenu active={researchActive} />
            </nav>
          ) : (
            <nav aria-label="Main navigation">
              {RESEARCH.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
            </nav>
          )}
          <div className="tools">
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
