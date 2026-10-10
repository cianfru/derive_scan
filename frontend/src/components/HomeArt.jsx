// The pictures on the home cards (pages/Home.jsx), one per card. The owner supplies the final icons
// (9 October 2026: "that probably is going to be my job"); each is one entry here, so a new icon is
// one swap. Flat, single-colour drawings in the data colours; decorative, so hidden from readers.
import { useState } from "react";
import { WalletEmblem } from "./WalletTag.jsx";

const UP = "var(--up)", DOWN = "var(--down)", GOLD = "var(--home-gold)", LINE = "var(--border-strong)", INK = "var(--text-2)";

// The owner's Saloon picture (10 October 2026: "I want to use this image for the bubbles card"), with the
// drawn bubbles as the fallback if it does not load.
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
function RadarArt() {
  return (
    <svg viewBox="0 0 96 96" className="home-art-svg home-art-sq" aria-hidden="true" focusable="false">
      <circle cx="48" cy="48" r="44" fill="none" stroke={LINE} strokeWidth="2" /><circle cx="48" cy="48" r="26" fill="none" stroke={LINE} strokeWidth="2" />
      <line x1="48" y1="4" x2="48" y2="92" stroke={LINE} strokeWidth="2" /><line x1="4" y1="48" x2="92" y2="48" stroke={LINE} strokeWidth="2" />
      <circle cx="66" cy="30" r="8" fill={UP} /><circle cx="30" cy="62" r="6" fill={DOWN} /><circle cx="58" cy="60" r="5" fill="var(--neutral, #aca79f)" />
    </svg>
  );
}
function PossesArt() {
  return (
    <svg viewBox="0 0 70 70" className="home-art-svg home-art-sq" aria-hidden="true" focusable="false">
      <path d="M35 6l8 17 18 2-13 13 4 18-17-9-17 9 4-18L9 25l18-2z" fill="none" stroke={GOLD} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
function OptionsArt() {
  return (
    <svg viewBox="0 0 300 140" className="home-art-svg" aria-hidden="true" focusable="false">
      <path d="M0 110 C60 108 90 30 150 30 S240 108 300 110" fill="none" stroke={INK} strokeWidth="3" />
      <line x1="105" y1="12" x2="105" y2="138" stroke={DOWN} strokeWidth="2.5" /><line x1="195" y1="12" x2="195" y2="138" stroke={UP} strokeWidth="2.5" />
    </svg>
  );
}
/** The smart traders' own hat avatars: the three best-ranked wallets on the leaderboard. */
function TradersArt({ addresses = [] }) {
  if (!addresses.length) return null;
  return <span className="home-hats">{addresses.slice(0, 3).map((a) => <WalletEmblem key={a} address={a} size={44} />)}</span>;
}

export const HOME_ART = { saloon: SaloonArt, radar: RadarArt, posses: PossesArt, options: OptionsArt, traders: TradersArt };
