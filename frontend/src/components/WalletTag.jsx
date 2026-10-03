import { codename, shortAddr } from "../lib/walletName.js";
import { BRAND_STROKE, BRAND_TILE, BRAND_VIEW, brandName, brandShapes, brandSpec } from "../lib/walletBrand.js";

// A cattle brand drawn from the address (lib/walletBrand.js): one iron stroke on a soft tile, in an
// accent kept off green and red. The accent follows the theme through CSS (--em, --em-light).
export function WalletEmblem({ address, size = 20 }) {
  const s = brandSpec(address);
  return (
    <svg className="wtag-av" width={size} height={size} viewBox={`0 0 ${BRAND_VIEW} ${BRAND_VIEW}`} aria-hidden="true" focusable="false"
      style={{ "--em": s.accent, "--em-light": s.accentLight }} data-brand={brandName(s)}>
      <path d={BRAND_TILE.d} className="em-tile" />
      <g className="em-iron" strokeWidth={BRAND_STROKE}>
        {brandShapes(s).map((x, i) => <path key={i} d={x.d} />)}
      </g>
    </svg>
  );
}

// A wallet as its brand and made-up codename ("Cobalt Heron"); the full address is in the
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
