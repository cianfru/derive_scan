import { useEffect, useRef, useState } from "react";
import SaloonPrototype from "./SaloonPrototype.jsx";
import MarketsPrototype from "./MarketsPrototype.jsx";
import TradersPrototype from "./TradersPrototype.jsx";
import snapshot from "./snapshot.json";
import lightLogo from "../../public/brand/cowboy-lockup-on-light.svg";
import darkLogo from "../../public/brand/cowboy-lockup-on-dark.svg";

const VIEWS = ["saloon", "outcome", "markets", "leaderboard", "cohorts"];
const CURRENT = { saloon: "/saloon", outcome: "/q/BTC-20261007-A-83000-89000", markets: "/markets", leaderboard: "/traders", cohorts: "/traders/cohorts" };
const NOTES = {
  saloon: { title: "Make the comparison concrete.", changes: [
    ["One amount across the board", "Changing the budget updates the maximum dollars back on every outcome. People compare a spend they understand, rather than a return percentage calculated for an unseen reference amount."],
    ["One card, one decision", "Coin, level and settlement date lead. Higher and Lower remain equally available; payout limits and the partial-payout zone are visible before opening the ticket."],
    ["Facts drive discovery", "Coin, date and price filters organize the board. Research readings remain context and do not reorder the outcomes."],
  ] },
  outcome: { title: "Understand the result before the order.", changes: [
    ["A visible settlement ramp", "The payout diagram makes the partial-payout zone explicit. Moving the settlement price shows dollars back and the net result for the selected amount."],
    ["Cost, payout and loss together", "The ticket groups total spend, fees, maximum payout and maximum loss on one basis. Contract mechanics move into detail, while the obligation stays visible."],
    ["Research one step away", "The daily trend, wallet positioning and options pricing are labelled in words, with their observation windows. The trader retains the decision."],
  ] },
  markets: { title: "Read three independent layers.", changes: [
    ["Words before symbols", "Daily regime, wallet positioning and options pricing have distinct columns. A person can understand a row without learning an icon legend."],
    ["Windows with their meaning", "The wallet expiry window and options tenor are explicit. Changing them does not imply that the daily regime becomes a different timeframe."],
    ["Keep the daily bars", "The existing individual daily bars are retained and made taller. Hover reveals the date and that day’s coin groups without adding permanent labels."],
  ] },
  leaderboard: { title: "Make a ranking assessable.", changes: [
    ["Result scope beside the result", "Gross results on expired options are labelled before fees. They are not presented as total wallet returns or the performance of open positions."],
    ["Samples beside win rates", "The number of expired instruments sits beside the rate, so a user can judge how much evidence a percentage represents."],
    ["Inspect before interpreting", "Search, trading-style filters and an expandable wallet record expose the published information behind each row. No copy-trading or edge claim is added."],
  ] },
  cohorts: { title: "Compare groups without decoding slang.", changes: [
    ["Thresholds and counts lead", "Plain result ranges and premium-traded size bands make groups comparable. Existing cohort names remain secondary."],
    ["Exposure is not a vote", "Coin positioning shows directional exposure with its valuation coverage. A long balance is not described as the percentage of wallets agreeing."],
    ["The selection owns the summary", "Changing a group or expiry window changes its rows and readout together. Counts and missing-data states remain visible."],
  ] },
};

function initialView() { const v = location.hash.slice(1); return VIEWS.includes(v) ? v : "saloon"; }
function initialTheme() {
  let theme = "light";
  try { if (localStorage.getItem("cowboy-prototype-theme") === "dark") theme = "dark"; } catch {}
  document.documentElement.dataset.theme = theme;
  return theme;
}
function initialFollows() {
  try {
    const saved = JSON.parse(localStorage.getItem("cowboy-prototype-follows") || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch { return new Set(); }
}
const captured = new Date(snapshot.snapshotAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function DesignNotes({ view, close }) {
  const panel = useRef(null);
  const note = NOTES[view];
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus();
    const key = (e) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab") return;
      const nodes = [...panel.current.querySelectorAll("button, a[href]")];
      const next = e.shiftKey ? nodes[0] : nodes.at(-1);
      if (document.activeElement === next) { e.preventDefault(); (e.shiftKey ? nodes.at(-1) : nodes[0])?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return <div className="cp-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <aside ref={panel} className="cp-design-notes" role="dialog" aria-modal="true" aria-labelledby="design-notes-title">
      <div className="cp-notes-top"><span className="cp-eyebrow">Design rationale</span><button className="cp-icon-button" onClick={close} aria-label="Close design notes">×</button></div>
      <h2 id="design-notes-title">{note.title}</h2>
      <p className="cp-notes-intro">Changes proposed for this screen, and the user problem each addresses.</p>
      {note.changes.map(([title, why], i) => <section key={title}><span className="cp-note-n">0{i + 1}</span><h3>{title}</h3><p>{why}</p></section>)}
      <a className="cp-button" href={`https://cowboy.trading${CURRENT[view]}`} target="_blank" rel="noreferrer">Compare with the current product ↗</a>
      <p className="cp-notes-foot">These are design hypotheses. Validate them with trader tasks before a public rollout.</p>
    </aside>
  </div>;
}

export default function CowboyPrototype() {
  const [view, setView] = useState(initialView);
  const [selection, setSelection] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const [notes, setNotes] = useState(false);
  const [followed, setFollowed] = useState(initialFollows);
  const active = ["saloon", "outcome"].includes(view) ? "saloon" : view === "markets" ? "markets" : "traders";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("cowboy-prototype-theme", theme); } catch {}
  }, [theme]);
  useEffect(() => {
    try { localStorage.setItem("cowboy-prototype-follows", JSON.stringify([...followed])); } catch {}
  }, [followed]);
  useEffect(() => {
    const changed = () => { const next = location.hash.slice(1); if (VIEWS.includes(next)) setView(next); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const navigate = (next, params = null) => {
    if (!VIEWS.includes(next)) return;
    setSelection(params);
    setView(next);
    history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  return <div className="cp-app">
    <a href="#prototype-main" className="cp-skip">Skip to content</a>
    <header className="cp-header">
      <div className="cp-header-inner">
        <button className="cp-brand" onClick={() => navigate("saloon")} aria-label="Cowboy Saloon"><img src={theme === "light" ? lightLogo : darkLogo} alt="Cowboy" /></button>
        <nav className="cp-nav" aria-label="Main navigation">
          {[["saloon", "Saloon"], ["markets", "Markets"], ["leaderboard", "Traders"]].map(([key, label]) => <button key={key} aria-current={active === (key === "leaderboard" ? "traders" : key) ? "page" : undefined} onClick={() => navigate(key)}>{label}</button>)}
        </nav>
        <div className="cp-header-actions"><button className="cp-notes-button" onClick={() => setNotes(true)}>Why this design</button><button className="cp-icon-button cp-theme" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} onClick={() => { const next = theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; setTheme(next); }}>
          {theme === "light" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20.5 14.4A8.7 8.7 0 0 1 9.6 3.5a8.8 8.8 0 1 0 10.9 10.9Z" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19" /></svg>}
        </button></div>
      </div>
    </header>
    <div className="cp-preview"><span>Interactive design preview</span><span>Snapshot <time>{captured} UTC</time></span></div>
    <main id="prototype-main" className="cp-main">
      {["saloon", "outcome"].includes(view) ? <SaloonPrototype data={snapshot} view={view} selection={selection} navigate={navigate} followed={followed} setFollowed={setFollowed} /> : view === "markets" ? <MarketsPrototype data={snapshot} navigate={navigate} /> : <TradersPrototype data={snapshot} view={view} navigate={navigate} />}
    </main>
    <footer className="cp-footer"><span>Cowboy <span className="cp-footer-sep">/</span> Clarity before commitment.</span><span>Derive snapshot · Context, not a signal.</span></footer>
    {notes && <DesignNotes view={view} close={() => setNotes(false)} />}
  </div>;
}
