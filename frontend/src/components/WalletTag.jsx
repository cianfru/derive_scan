import { useId } from "react";
import { codename, shortAddr } from "../lib/walletName.js";
import { EMBLEM_VIEW, PLATE, emblemShapes, emblemSpec } from "../lib/walletEmblem.js";

// A machined badge drawn from the address (lib/walletEmblem.js).
export function WalletEmblem({ address, size = 20 }) {
  const s = emblemSpec(address);
  const cut = useId();
  const shapes = emblemShapes(s);
  return (
    <svg className="wtag-av" width={size} height={size} viewBox={`0 0 ${EMBLEM_VIEW} ${EMBLEM_VIEW}`} aria-hidden="true" focusable="false">
      <defs><mask id={cut}><rect width="36" height="36" fill="#fff" />{shapes.filter((x) => x.hole).map((x, i) => <path key={i} d={x.d} fill="#000" />)}</mask></defs>
      <path d={PLATE} className="em-plate" />
      {s.stripe === 0 && <path d="M1 8L8 1H11L1 11Z" fill={s.accent} opacity=".9" />}
      {s.stripe === 1 && <path d="M25 35L35 25V28L28 35Z" fill={s.accent} opacity=".9" />}
      <g mask={`url(#${cut})`}>
        {shapes.filter((x) => !x.hole).map((x, i) => (
          <path key={i} d={x.d} fill={x.fill ? s.accent : "none"} stroke={x.stroke ? s.accent : "none"}
            strokeWidth={x.wide ? 2.6 : 1.6} strokeLinecap="square" strokeLinejoin="miter" opacity={x.faint ? 0.45 : 1} />))}
      </g>
    </svg>
  );
}

// A wallet as its emblem and made-up codename ("Cobalt Heron"); the full address is in the
// hover title. addr: the short address after the name; sub: the short address under it.
export default function WalletTag({ address, name, size = 20, addr = false, sub = false, className = "" }) {
  if (!address) return null;
  const label = name || codename(address);
  return (
    <span className={`wtag${sub ? " wtag-stack" : ""}${className ? ` ${className}` : ""}`} title={`${label}\n${address}`}>
      <WalletEmblem address={address} size={size} />
      {sub
        ? <span className="wtag-text"><span className="wtag-name">{label}</span><span className="wtag-addr">{shortAddr(address)}</span></span>
        : <span className="wtag-name">{label}</span>}
      {addr && !sub && <span className="wtag-addr">{shortAddr(address)}</span>}
    </span>
  );
}
