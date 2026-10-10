import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { loadPositions } from "../lib/positions.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { useFeeds } from "../components/Feeds.jsx";
import { openPnl, pctText } from "../lib/homePnl.js";
import { HOME_ART } from "../components/HomeArt.jsx";
import { HOME_LIVE } from "../components/HomeLive.jsx";
import "../home.css";

// The card home (owner, 9 October 2026, after Apple's "Why you'll love Mac" page): one card per part
// of Cowboy, flat, one short line and one picture each. A click on a card opens its page; the + opens
// the card large over the page with a short explanation and one button.
export const CARDS = [
  { id: "saloon", to: "/saloon", label: "Saloon", title: "Pick higher or lower. See the cost first.", size: "tall", cta: "Enter the Saloon",
    about: "Each bubble is one answer: higher or lower than a price on a date. The figure inside is the most it makes on $100, Derive's fees included. A gold ring shows where smart wallets lean." },
  { id: "positions", to: "/saloon/mine", label: "Your positions", title: "Your P&L, at a glance.", cta: "Open your positions",
    about: "What you hold and what it is worth now, what you sold back or settled, and your profit or loss after fees. The figure on this card is your open positions at Derive's sell-back price after fees, as a share of what you paid." },
  { id: "radar", to: "/radar", label: "Radar", title: "Who's stretched, who's not.", cta: "Open the radar",
    about: "Every coin on one map: how far its price has stretched from its trend, against how the smart wallets are positioned on it." },
  { id: "traders", to: "/traders", label: "Smart traders", title: "Follow the best options traders.", cta: "Open the leaderboard",
    about: "Derive's options traders ranked by their results, market makers left out. Open any one to see what they hold and how they have done." },
  { id: "markets", to: "/markets", label: "Markets", title: "Every coin, three reads.", cta: "Open the markets",
    about: "For each coin: the market's regime, how the smart wallets are positioned, and what option prices say, for the next 7 and 30 days." },
  { id: "posses", to: "/traders/posses", label: "Posses", title: "Legends to Boot Hill.", cta: "Open the posses",
    about: "Every trader grouped by results, from Legend to Boot Hill, and by size, from Railroad Baron to Tenderfoot, with how each group is positioned." },
  { id: "options", to: "/options", label: "Options & flow", title: "See what option prices imply, and the big trades.", size: "wide", cta: "Open options",
    about: "The price ranges option prices imply for each date, where open interest sits, and the large trades going through Derive." },
];

const PLUS = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>;

/** Your positions as one percentage: open positions at Derive's sell-back price after fees, over what
 * was paid for them; "No open positions" when there are none. Boards load only for the coins held. */
function PositionsFigure() {
  const [list, setList] = useState(null);
  useEffect(() => { try { setList(loadPositions(TESTNET_FILLS ? "testnet" : "mainnet")); } catch { setList([]); } }, []);
  const unds = [...new Set((list || []).filter((p) => !p.closed_at).map((p) => p.und).filter(Boolean))];
  const [feeds, files] = useFeeds(unds.map((u) => `questions/${u}.json`));
  if (!list) return null;
  const r = openPnl(list, Object.fromEntries(unds.map((u) => [u, files[`questions/${u}.json`]])));
  const n = `${r.open} open`;
  return <>{feeds}{!r.open ? <span className="home-pnl-none">No open positions</span>
    : r.pct == null ? <span className="home-pnl-none">{n}</span>
      : <span className="home-pnl"><span className={`home-pnl-num ${r.pct >= 0 ? "up" : "down"}`}>{pctText(r.pct)}</span><span className="home-fig">{n}</span></span>}</>;
}

/** The Saloon card's figure line; left out while its file is missing. */
function useFigures() {
  const { data: q } = useData("questions/index.json");
  const coins = q?.coins || [];
  const rings = coins.reduce((s, c) => s + (c.smart || 0), 0);
  return { saloon: coins.length ? `${coins.length} coins open${rings ? ` · ${rings} gold rings` : ""}` : null };
}

export default function Home() {
  const fig = useFigures();
  const navigate = useNavigate();
  const [popped, setPopped] = useState(null);
  const dialog = useRef(null), opener = useRef(null);
  const card = CARDS.find((c) => c.id === popped);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (card && !d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
    if (!card && d.open) { if (d.close) d.close(); else d.removeAttribute("open"); }
  }, [card]);
  const close = () => { setPopped(null); opener.current?.focus(); };
  return (
    <div className="wrap page home">
      <header className="home-intro">
        <h1>Where do you want to ride?</h1>
        <p>Pick a card to open it.</p>
      </header>
      <div className="home-grid">
        {CARDS.map((c) => {
          const Art = HOME_ART[c.id];
          const figure = fig[c.id];
          return (
            <article key={c.id} className={`home-card${c.size ? ` home-${c.size}` : ""}${HOME_LIVE[c.id] ? " home-live" : ""}`} onClick={() => navigate(c.to)}>
              <Link to={c.to} className="home-link" onClick={(e) => e.stopPropagation()}>
                <span className="home-label">{c.label}</span>
                <h2 className={HOME_LIVE[c.id] ? "sr-only" : undefined}>{c.title}</h2>
              </Link>
              <div className="home-art">
                {HOME_LIVE[c.id] ? (() => { const Live = HOME_LIVE[c.id]; return <Live />; })() : Art ? <Art /> : null}
                {c.id === "positions" && <PositionsFigure />}
                {figure && <span className="home-fig">{figure}</span>}
              </div>
              <button type="button" className="home-plus" aria-label={`More about ${c.label}`}
                onClick={(e) => { e.stopPropagation(); opener.current = e.currentTarget; setPopped(c.id); }}>{PLUS}</button>
            </article>
          );
        })}
      </div>
      <dialog ref={dialog} className="home-pop" aria-labelledby="home-pop-title" onCancel={(e) => { e.preventDefault(); close(); }}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {card && <div className="home-pop-body">
          <button type="button" className="home-pop-x" aria-label="Close" onClick={close}><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" /></svg></button>
          <span className="home-label">{card.label}</span>
          <h2 id="home-pop-title">{card.title}</h2>
          <p>{card.about}</p>
          {HOME_LIVE[card.id] ? <div className="home-pop-art home-pop-live">{(() => { const Live = HOME_LIVE[card.id]; return <Live />; })()}</div>
            : HOME_ART[card.id] && <div className="home-pop-art">{(() => { const Art = HOME_ART[card.id]; return <Art />; })()}</div>}
          <Link className="btn primary lg" to={card.to} onClick={() => setPopped(null)}>{card.cta}</Link>
        </div>}
      </dialog>
    </div>
  );
}
