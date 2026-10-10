// Pictures on the home cards (pages/Home.jsx): only the Saloon card keeps one (the owner's picture); the
// others are drawn from live data (components/HomeLive.jsx) since the drawn icons looked cheap (owner,
// 10 October 2026). Decorative, so hidden from readers.
import { useState } from "react";

const UP = "var(--up)", DOWN = "var(--down)", GOLD = "var(--home-gold)", INK = "var(--text-2)";

// The owner's Saloon pictures (10 October 2026): on charcoal for the dark theme, and a copy with no
// background for the light one; the drawn bubbles stand in if either fails to load.
function SaloonArt() {
  const [failed, setFailed] = useState({});
  const pic = (key, src, cls) => (failed[key] ? <span className={cls}><SaloonDrawn /></span>
    : <img className={`home-art-img ${cls}`} src={src} alt="" width="1536" height="1024" decoding="async"
      onError={() => setFailed((f) => ({ ...f, [key]: true }))} />);
  return <>{pic("dark", "/home/saloon.webp", "home-art-dark")}{pic("light", "/home/saloon-light.webp", "home-art-light")}</>;
}
function SaloonDrawn() {
  return (
    <svg viewBox="0 0 420 240" className="home-art-svg" aria-hidden="true" focusable="false">
      <line x1="0" y1="130" x2="420" y2="130" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 5" />
      <polyline points="0,162 30,142 55,152 85,120 110,130 140,112 165,124 190,130" fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="250" cy="72" r="28" fill={UP} /><circle cx="330" cy="46" r="32" fill={UP} stroke={GOLD} strokeWidth="4" />
      <circle cx="398" cy="104" r="18" fill={UP} /><circle cx="250" cy="190" r="28" fill={DOWN} /><circle cx="330" cy="200" r="24" fill={DOWN} />
    </svg>
  );
}
export const HOME_ART = { saloon: SaloonArt };
