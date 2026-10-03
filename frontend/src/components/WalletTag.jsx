import { codename, shortAddr } from "../lib/walletName.js";

// A wallet as its made-up codename ("Cobalt Heron"), no picture; the full address is in the
// hover title. addr: the short address after the name; sub: the short address under it.
export default function WalletTag({ address, name, size = 20, addr = false, sub = false, className = "" }) {
  if (!address) return null;
  const label = name || codename(address);
  return (
    <span className={`wtag${sub ? " wtag-stack" : ""}${className ? ` ${className}` : ""}`} title={`${label}\n${address}`}>
      {sub
        ? <span className="wtag-text"><span className="wtag-name">{label}</span><span className="wtag-addr">{shortAddr(address)}</span></span>
        : <span className="wtag-name">{label}</span>}
      {addr && !sub && <span className="wtag-addr">{shortAddr(address)}</span>}
    </span>
  );
}
