import { codename, shortAddr } from "../lib/walletName.js";
import { walletAvatar } from "../lib/walletAvatar.js";
import { HAT_ICON } from "./Brand.jsx";
import "../wallet-avatar.css";

// The Cowboy hat on an address-derived tile, with paired colours for both themes.
export function WalletEmblem({ address, size = 20 }) {
  const s = walletAvatar(address);
  return (
    <svg className="wtag-av wtag-hat" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false"
      style={{ "--hat-dark": s.dark, "--hat-light": s.light, "--hat-background": s.background, "--hat-background-light": s.backgroundLight }} data-avatar={s.key}>
      <rect x="1" y="1" width="62" height="62" rx="14" className="wa-tile" />
      <path d={HAT_ICON} transform="translate(5 5) scale(.84)" className="wa-mark" strokeWidth="5" />
    </svg>
  );
}

// A wallet as its hat and made-up codename ("Cobalt Heron"); the full address is in the
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
