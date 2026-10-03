import { useEffect, useRef } from "react";
import "../neon.css";

// The owner's vector lockup (hat and COWBOY), one path per tube. Header paths sit in absolute lockup
// units; the sign's paths carry their own offsets, exactly as in the owner's files.
const HAT = "translate(10 15)";
const WORD = "translate(560 130)";
export const TUBES = [
  ["crown", HAT, "M 166,233 C 171,192 183,140 201,98 C 211,72 228,67 243,84 C 269,116 266,141 307,152 C 328,158 356,155 372,171 C 388,188 384,233 387,256 M 222,72 C 250,62 276,93 313,91 M 287,108 C 315,98 345,69 365,92 C 383,115 381,170 400,241 C 407,268 390,280 361,284 C 301,294 227,280 177,265"],
  ["brim", HAT, "M 170,235 L 119,234 M 408,258 C 452,240 479,239 487,273 C 504,334 456,372 409,358 C 310,332 230,287 149,247 C 104,225 70,208 48,227 C 22,248 53,294 92,316 C 151,351 259,364 324,360"],
  ["c", WORD, "M 121,46 C 88,10 18,20 18,82 C 18,146 88,154 121,121"],
  ["o1", WORD, "M 212,24 C 171,24 145,48 145,84 C 145,122 172,146 212,146 C 252,146 279,122 279,84 C 279,48 252,24 212,24 Z"],
  ["w", WORD, "M 298,26 L 329,145 L 369,57 L 410,145 L 443,26"],
  ["b", WORD, "M 470,145 L 470,26 L 514,26 C 559,26 561,80 516,84 L 470,84 M 516,84 C 569,84 569,145 515,145 L 470,145"],
  ["o2", WORD, "M 646,24 C 605,24 579,48 579,84 C 579,122 606,146 646,146 C 686,146 713,122 713,84 C 713,48 686,24 646,24 Z"],
  ["y", WORD, "M 733,26 L 774,85 L 816,26 M 774,85 L 774,145"],
];
// The simplified hat (64 x 64) for marks under 24 px.
export const HAT_ICON = "M20.1 36.5C21.1 26.8 23 17.6 25.8 13C27.2 9.5 31.1 9.5 33 13.5C34.7 16.4 36 18.7 38.2 18.7C40.1 18.7 41 13.5 43.9 13.5C46.7 13.5 48.1 16.4 48.1 22.1C48.1 27.9 48.1 33.6 48.1 38.2M49.1 38.2C53.8 36 57.6 36 58.6 40.5C60.5 48.6 54.8 54.3 49.1 52.6C37.7 49.2 28.2 42.9 18.2 37.1C13 34.2 8.2 31.9 5.9 34.8C3 38.8 7.3 44.6 12.1 47.5C17.8 51.1 27.2 53.2 34.9 53.4";

const Tubes = () => TUBES.map(([k, t, d]) => <path key={k} d={d} transform={t} />);

/** The small lit lockup for the header and footer: two layers, no blur, widths in screen pixels. */
export function Lockup({ className = "lockup" }) {
  return (
    <svg className={className} viewBox="36 72 1354 316" aria-hidden="true" focusable="false">
      <g className="lk-tube"><Tubes /></g>
      <g className="lk-core"><Tubes /></g>
    </svg>
  );
}

/** The simplified hat, in the current text colour or the logo tube. */
export function HatMark({ size = 24, className = "hat-mark" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d={HAT_ICON} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The sign's lit layers, widest first: halo, glow, tube, core, hot (lockup units).
const LIT = [["#ff5900", 20, 0.42, "n-halo"], ["#ff6500", 12, 0.85, "n-glow"], ["#ff740f", 10], ["#ffb54c", 6], ["#fff3ca", 2.5]];

/** The landing sign: unlit glass under five lit layers; switch-on, then an idle flicker (neon.css).
 * Steady under reduced motion; paused while scrolled out of view. */
export function NeonSign() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => el.classList.toggle("is-paused", !e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const vb = "16 50 1392 360";
  return (
    <div className="neon-sign" ref={ref} role="img" aria-label="Cowboy">
      <div className="neon-spill" aria-hidden="true" />
      <svg className="neon-glass" viewBox={vb} aria-hidden="true" focusable="false">
        <defs>{TUBES.map(([k, t, d]) => <path key={k} id={`n-${k}`} d={d} transform={t} />)}</defs>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g stroke="#3a2a20" strokeWidth="10">{TUBES.map(([k]) => <use key={k} href={`#n-${k}`} />)}</g>
          <g stroke="#55402f" strokeWidth="2.5">{TUBES.map(([k]) => <use key={k} href={`#n-${k}`} />)}</g>
        </g>
      </svg>
      <svg className="neon-lit" viewBox={vb} aria-hidden="true" focusable="false">
        <defs>
          <filter id="n-halo" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="10" /></filter>
          <filter id="n-glow" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3.5" /></filter>
        </defs>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {LIT.map(([c, w, o, f]) => (
            <g key={c} stroke={c} strokeWidth={w} opacity={o}>
              {TUBES.map(([k]) => <use key={k} href={`#n-${k}`} className={`nt-${k}`} filter={f ? `url(#${f})` : undefined} />)}
            </g>))}
        </g>
      </svg>
    </div>
  );
}
