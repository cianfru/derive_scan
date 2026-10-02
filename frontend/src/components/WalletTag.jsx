import { AVATAR_VIEW, AVATAR_OUTLINE, avatarShapes, avatarSpec } from "../lib/walletAvatar.js";
import { codename, shortAddr } from "../lib/walletName.js";

export function WalletAvatar({ address, size = 20 }) {
  const s = avatarSpec(address);
  return (
    <svg className="wtag-av" width={size} height={size} viewBox={`0 0 ${AVATAR_VIEW} ${AVATAR_VIEW}`} aria-hidden="true" focusable="false">
      <path d={AVATAR_OUTLINE} fill="#171f20" />
      <path d={AVATAR_OUTLINE} fill={s.body} fillOpacity=".08" stroke={s.body} strokeOpacity=".35" />
      <g transform={`rotate(${s.rotate} 18 18) translate(3 3) scale(.833333)`}>
        {avatarShapes(s).map((shape, i) => <path key={i} {...shape} />)}
      </g>
    </svg>
  );
}

// A wallet as its avatar and made-up codename ("Cobalt Heron"); the full address is in the
// hover title. addr: the short address after the name; sub: the short address under it.
export default function WalletTag({ address, name, size = 20, addr = false, sub = false, className = "" }) {
  if (!address) return null;
  const label = name || codename(address);
  return (
    <span className={`wtag${sub ? " wtag-stack" : ""}${className ? ` ${className}` : ""}`} title={`${label}\n${address}`}>
      <WalletAvatar address={address} size={size} />
      {sub
        ? <span className="wtag-text"><span className="wtag-name">{label}</span><span className="wtag-addr">{shortAddr(address)}</span></span>
        : <span className="wtag-name">{label}</span>}
      {addr && !sub && <span className="wtag-addr">{shortAddr(address)}</span>}
    </span>
  );
}
