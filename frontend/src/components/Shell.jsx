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

export default function Shell() {
  const [theme, toggle] = useTheme();
  const { pathname, hash } = useLocation();
  const header = useRef(null);
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
            // The Saloon leads; the research pages follow, smaller, after a divider.
            <nav aria-label="Main navigation" className="nav-saloon">
              <NavLink to="/saloon" className={({ isActive }) => `nav-primary${isActive || pathname.startsWith("/q/") || pathname.startsWith("/saloon") ? " active" : ""}`}>
                <HatMark size={18} />Saloon
              </NavLink>
              <span className="nav-divider" aria-hidden="true" />
              <div className="nav-research" role="group" aria-label="Research">
                {RESEARCH.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
              </div>
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
