// The pictures on the home cards (pages/Home.jsx), one per card. The owner supplies the final icons
// (9 October 2026: "that probably is going to be my job"); each is one entry here, so a new icon is
// one swap. Flat, single-colour drawings in the data colours; decorative, so hidden from readers.
import { useState } from "react";
import { WalletEmblem } from "./WalletTag.jsx";

const UP = "var(--up)", DOWN = "var(--down)", GOLD = "var(--home-gold)", LINE = "var(--border-strong)", INK = "var(--text-2)";

// The owner's Saloon picture (10 October 2026: "I want to use this image for the bubbles card"), with the
// drawn bubbles as the fallback if it does not load.
function SaloonArt() {
  const [failed, setFailed] = useState(false);
  return <>
    {failed ? <span className="home-art-dark"><SaloonDrawn /></span>
      : <img className="home-art-img home-art-dark" src="/home/saloon.webp" alt="" width="1536" height="1024" decoding="async" onError={() => setFailed(true)} />}
    <SaloonLight />
  </>;
}

// The same picture drawn for the light theme (owner, 10 October 2026: "on a white background, we don't
// have a dark image"): an ink price line, the orange price-now line, glossy bubbles with dark figures,
// a gold ring and dotted stems, on no background.
function Ball({ x, y, r, up, label, ring }) {
  const id = up ? "hl-up" : "hl-down", ink = up ? "#0f3a2d" : "#4a160d", a = r * 0.17, ay = y - r * 0.32;
  return <g>
    <circle cx={x} cy={y + r * 0.9} r={r * 0.8} fill={up ? "#5fd0aa" : "#f07a66"} opacity=".16" filter="url(#hl-blur)" />
    {ring && <circle cx={x} cy={y} r={r + 7} fill="none" stroke="#f5a524" strokeWidth="5" filter="url(#hl-gold)" />}
    <circle cx={x} cy={y} r={r} fill={`url(#${id})`} />
    <ellipse cx={x - r * 0.3} cy={y - r * 0.45} rx={r * 0.42} ry={r * 0.22} fill="#fff" opacity=".55" />
    <path d={up ? `M${x - a} ${ay + a * 0.45}L${x} ${ay - a * 0.55}L${x + a} ${ay + a * 0.45}Z` : `M${x - a} ${ay - a * 0.45}L${x} ${ay + a * 0.55}L${x + a} ${ay - a * 0.45}Z`} fill={ink} />
    <text x={x} y={y + r * 0.3} textAnchor="middle" fill={ink} fontFamily="Manrope, sans-serif" fontWeight="800" fontSize={r * 0.5} letterSpacing="-0.02em">{label}</text>
  </g>;
}
function SaloonLight() {
  const NOW = 268, stem = (x, y1, up) => <g>
    <line x1={x} x2={x} y1={NOW} y2={y1} stroke={up ? "#2f9c79" : "#c4513f"} strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
    <circle cx={x} cy={NOW + (up ? -10 : 10)} r="5" fill={up ? "#5fd0aa" : "#f07a66"} /></g>;
  return (
    <svg viewBox="0 0 760 500" className="home-art-svg home-art-light" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hl-up" cx=".36" cy=".3" r=".8" fx=".32" fy=".24"><stop offset="0" stopColor="#c9f4e5" /><stop offset=".55" stopColor="#5fd0aa" /><stop offset="1" stopColor="#3fa985" /></radialGradient>
        <radialGradient id="hl-down" cx=".36" cy=".3" r=".8" fx=".32" fy=".24"><stop offset="0" stopColor="#ffd3c9" /><stop offset=".55" stopColor="#f07a66" /><stop offset="1" stopColor="#c95945" /></radialGradient>
        <filter id="hl-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
        <filter id="hl-gold" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="hl-line" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#3a332c" floodOpacity=".18" /></filter>
      </defs>
      <line x1="20" x2="740" y1={NOW} y2={NOW} stroke="#e0661a" strokeWidth="3.5" strokeDasharray="16 12" strokeLinecap="round" />
      <path d="M20 352 C80 330 120 290 175 296 S240 330 275 312 S330 250 360 252 S410 266 432 262 S470 205 500 212 S540 196 548 192"
        fill="none" stroke="#3a332c" strokeWidth="9" strokeLinecap="round" filter="url(#hl-line)" />
      <circle cx="432" cy="262" r="11" fill="#fff" stroke="#e0661a" strokeWidth="3" /><circle cx="432" cy="262" r="5.5" fill="#e0661a" />
      <circle cx="355" cy="205" r="22" fill="url(#hl-up)" opacity=".75" /><circle cx="728" cy="237" r="17" fill="url(#hl-up)" opacity=".75" />
      {stem(560, 245, true)}{stem(660, 160, true)}{stem(560, 338, false)}{stem(660, 352, false)}
      <Ball x={560} y={182} r={58} up label="+86%" />
      <Ball x={660} y={103} r={58} up ring label="+203%" />
      <Ball x={560} y={392} r={50} label="+123%" />
      <Ball x={660} y={410} r={56} label="+214%" />
    </svg>
  );
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
