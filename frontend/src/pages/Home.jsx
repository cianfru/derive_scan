import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { HOME_LIVE, SaloonLive, useHomePositions } from "../components/HomeLive.jsx";
import { CoinIcon } from "../components/MarketVisuals.jsx";
import { priceAge } from "../lib/questions.js";
import { useClock } from "../lib/useClock.js";
import "../home.css";

// The card home (owner, 9 October 2026, after Apple's "Why you'll love Mac" page: "use the first page as a
// selector ... cards ... pops up towards you"): one card per part of Cowboy. A click on a card opens its
// page; the + opens the card large over the page, grown out of the card, with a short explanation, the
// same widget in its roomy mode and one button.
export const CARDS = [
  { id: "saloon", to: "/saloon", label: "Saloon", title: "Pick higher or lower. See the cost first.", size: "tall", cta: "Enter the Saloon",
    about: "In the Saloon each bubble is one answer: higher or lower than a price on a date. The figure inside is the most it makes on $100, Derive's fees included. A gold ring shows where Smart wallets lean. Context, not a signal." },
  { id: "positions", to: "/saloon/mine", label: "Your positions", title: "Your P&L, at a glance.", cta: "Open your positions",
    about: "Your open positions at Derive's sell-back price after fees, as a share of what you paid for them, over every position saved in this browser. Positions without a price now are left out." },
  { id: "radar", to: "/radar", label: "Radar", title: "Who's stretched, who's not.", cta: "Open the radar",
    about: "Every coin with options on one map: how far its price has stretched from its trend, against how the Smart wallets are positioned on its options expiring within 30 days. Coins without a wallet reading sit faint on the dashed line under the map. Context, not a signal." },
  { id: "traders", to: "/traders", label: "Smart traders", title: "Follow the best options traders.", cta: "Open the leaderboard",
    about: "The best-ranked Smart wallets, the most profitable fifth of Derive's directional options traders, ranked by gross options P&L on expired options before fees, market makers left out. Open any one to see what they hold. Context, not a signal." },
  { id: "markets", to: "/markets", label: "Markets", title: "Every coin, three reads.", cta: "Open the markets",
    about: "For each coin with options: the market's regime, how the Smart wallets are positioned, and what option prices say, for the next 7 and 30 days. The figure counts options markets on the daily close." },
  { id: "posses", to: "/traders/posses", label: "Posses", title: "Legends to Boot Hill.", cta: "Open the posses",
    about: "Every options trader grouped by results on expired options, from Legend (at least $1M profit) to Boot Hill (more than $1M lost), and by size, with how each group is positioned. Market makers left out. Context, not a signal." },
  { id: "options", to: "/flow", label: "Options flow", title: "Where options money points.", size: "wide", cta: "Open flow",
    about: "Every coin with options on one map. Each bubble is the option money traded on that coin over the last 24 hours, placed by how much of it went into trades that gain if the price rises (buying calls, selling puts) or if it falls (buying puts, selling calls). Open a coin to see its trades. Market makers left out. Context, not a signal." },
];

const PLUS = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>;
const ENTERED = "cowboy-home-entered";
const EASE = "cubic-bezier(.2,.8,.2,1)";
const still = () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LINE_COINS = 6;
/** The Saloon card's figure line: the coins open now (six icons, then "+N") and the gold rings; "Prices
 * paused" while the Saloon itself reads paused (the flag, or prices older than 90 minutes). */
function SaloonLine() {
  const { data: q } = useData("questions/index.json");
  const now = useClock();
  const coins = q?.coins || [];
  if (q && priceAge(q.prices_ts, now, q.paused).state === "paused") return <p className="home-line"><span className="home-line-words">Prices paused</span></p>;
  if (!coins.length) return null;
  const rings = coins.reduce((s, c) => s + (c.smart || 0), 0);
  const more = coins.length - LINE_COINS;
  return (
    <p className="home-line">
      <span className="home-coins" aria-hidden="true">{coins.slice(0, LINE_COINS).map((c) => <span key={c.und}><CoinIcon und={c.und} /></span>)}
        {more > 0 && <b className="n home-more">+{more}</b>}</span>
      <span className="sr-only">Prices on {coins.map((c) => c.und).join(", ")}</span>
      {rings > 0 && <span className="home-line-words"><i className="home-ring" aria-hidden="true" /><b className="n">{rings}</b> gold rings</span>}
    </p>
  );
}

/** The transform that lays the open dialog over its card (centre and width): where it grows from and shrinks back to. */
function fromCard(d, r) {
  const b = d.getBoundingClientRect();
  if (!r || !b.width) return null;
  return `translate(${r.left + r.width / 2 - (b.left + b.width / 2)}px, ${r.top + r.height / 2 - (b.top + b.height / 2)}px) scale(${r.width / b.width})`;
}

export default function Home() {
  const navigate = useNavigate();
  const pos = useHomePositions();
  const [popped, setPopped] = useState(null);
  const dialog = useRef(null), opener = useRef(null), closing = useRef(false);
  // The cards rise in once per tab (owner: alive, not dry); a reload in the same tab shows them still.
  const [enter] = useState(() => { try { return !sessionStorage.getItem(ENTERED); } catch { return true; } });
  useEffect(() => { try { sessionStorage.setItem(ENTERED, "1"); } catch { /* the rise plays again next visit */ } }, []);
  const route = (c) => (c.id === "positions" ? { ...c, to: pos.to, cta: pos.cta } : c);
  const card = popped && route(CARDS.find((c) => c.id === popped));
  const cardRect = () => opener.current?.closest(".home-card")?.getBoundingClientRect() || null;
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!card) { if (d.open) { if (d.close) d.close(); else d.removeAttribute("open"); } return; }
    if (d.open) return;
    // The pop-out grows out of its card towards the viewer; without motion (or a card box) it simply appears.
    const from = !still() && d.animate ? cardRect() : null;
    d.classList.toggle("grow", !!from);
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    const t = from && fromCard(d, from);
    if (t) d.animate([{ transform: t, opacity: 0.5 }, { transform: "none", opacity: 1 }], { duration: 380, easing: EASE });
  }, [popped]); // eslint-disable-line react-hooks/exhaustive-deps
  const shut = () => {
    const d = dialog.current;
    closing.current = false;
    if (d?.open) { if (d.close) d.close(); else d.removeAttribute("open"); }
    setPopped(null);
    opener.current?.focus();
  };
  const close = () => {
    const d = dialog.current;
    if (closing.current) return;
    const t = d?.open && !still() && d.animate ? fromCard(d, cardRect()) : null;
    if (!t) return shut();
    closing.current = true;
    const a = d.animate([{ transform: "none", opacity: 1 }, { transform: t, opacity: 0 }], { duration: 260, easing: "cubic-bezier(.4,0,.7,.2)", fill: "forwards" });
    try { d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards", pseudoElement: "::backdrop" }); } catch { /* the backdrop simply goes with the dialog */ }
    a.onfinish = () => { shut(); d.getAnimations({ subtree: true }).forEach((x) => x.cancel()); };
  };
  const widget = (c, pop) => {
    const Live = HOME_LIVE[c.id];
    return Live ? <Live pos={pos} pop={pop} card={c} /> : c.id === "saloon" ? <SaloonLive pop={pop} /> : null;
  };
  return (
    <div className="wrap page home" data-enter={enter ? "" : undefined}>
      {pos.feeds}
      <header className="home-intro"><h1>Where do you want to ride?</h1></header>
      <div className="home-grid">
        {CARDS.map(route).map((c, i) => (
          <article key={c.id} className={`home-card home-${c.id}${c.size ? ` home-${c.size}` : ""}`} style={{ "--i": i }} onClick={() => navigate(c.to)}>
            <Link to={c.to} className="home-link" aria-describedby={`home-fig-${c.id}`} onClick={(e) => e.stopPropagation()}>
              <span className="home-label">{c.label}</span>
              <h2 className={HOME_LIVE[c.id] ? "sr-only" : undefined}>{c.title}</h2>
            </Link>
            <div className="home-art" id={`home-fig-${c.id}`}>
              {widget(c, false)}
              {c.id === "saloon" && <SaloonLine />}
            </div>
            <button type="button" className="home-plus" aria-label={`More about ${c.label}`}
              onClick={(e) => { e.stopPropagation(); opener.current = e.currentTarget; setPopped(c.id); }}>{PLUS}</button>
          </article>
        ))}
      </div>
      <dialog ref={dialog} className="home-pop" aria-labelledby="home-pop-title" onCancel={(e) => { e.preventDefault(); close(); }}
        onClose={() => { closing.current = false; setPopped(null); }}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {card && <div className={`home-pop-body home-pop-${card.id}`}>
          <span className="home-label">{card.label}</span>
          <button type="button" className="home-pop-x" aria-label="Close" onClick={close}><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" /></svg></button>
          <div className="home-pop-text">
            <h2 id="home-pop-title">{card.title}</h2>
            <p>{card.about}</p>
          </div>
          <div className="home-pop-stage">{widget(card, true)}</div>
          <Link className="btn primary lg home-pop-cta" to={card.to} onClick={() => setPopped(null)}>{card.cta}</Link>
        </div>}
      </dialog>
    </div>
  );
}
