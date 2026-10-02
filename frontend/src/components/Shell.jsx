import { useEffect, useState } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "");
  const sysDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = theme || (sysDark() ? "dark" : "light");
  const toggle = () => {
    const next = effective === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("torq-theme", next); } catch { /* storage may be blocked */ }
    setTheme(next);
  };
  return [effective, toggle];
}

export function Logo({ theme, height = 24 }) {
  const src = theme === "light" ? "/brand/torq-logo-on-light.webp" : "/brand/torq-logo-on-dark.webp";
  return <img src={src} alt="Torq" height={height} style={{ height, width: "auto" }} />;
}

export default function Shell() {
  const [theme, toggle] = useTheme();
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <>
      <div className={pathname === "/" ? "ground" : "ground quiet"} />
      <header className="hdr">
        <div className="wrap">
          <Link to="/" className="logo" aria-label="Torq home"><Logo theme={theme} /></Link>
          <nav>
            <NavLink to="/markets">Markets</NavLink>
            <NavLink to="/options">Options</NavLink>
            <NavLink to="/traders">Traders</NavLink>
            <NavLink to="/flow">Flow</NavLink>
          </nav>
          <div className="tools">
            <button className="icon-btn" onClick={toggle} aria-label="Switch light or dark">
              {theme === "dark"
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>}
            </button>
          </div>
        </div>
      </header>
      <main><Outlet context={{ theme }} /></main>
      <footer className="foot"><div className="wrap">
        <Logo theme={theme} height={18} />
        <span>Built on Derive · data refreshes every 15 minutes · nothing here is advice</span>
      </div></footer>
    </>
  );
}

export { useTheme };
