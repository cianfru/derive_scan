// What happens at settlement, drawn: the coin's price on the date along a line, the level splitting it in
// two, the price now marked, and under each side what the user ends with. The premium is theirs on both
// sides (owner, 10 October 2026: "I need something visual for me to understand what's going on").
import { money } from "../../lib/questions.js";

const usd = (v) => money(v, { cents: true });

export default function FridayPicture({ coin, level, size, sizeText, lockUsd, premium, price, when }) {
  const sale = !level.isPut;
  // The line spans 10% either side of the level; the price now sits where it falls on it.
  const at = Number.isFinite(price) ? Math.min(96, Math.max(4, 50 + ((price - level.strike) / (level.strike * 0.2)) * 100)) : null;
  const plus = premium != null ? `+ ${usd(premium)} premium` : "+ the premium";
  const below = sale
    ? { head: `You keep ${sizeText}`, sub: "Your coin comes back" }
    : { head: `You buy ${sizeText}`, sub: `for ${usd(lockUsd)}, at ${money(level.strike)} each` };
  const above = sale
    ? { head: `You sell ${sizeText}`, sub: `for ${usd(level.strike * size)}, at ${money(level.strike)} each` }
    : { head: `You get ${usd(lockUsd)} back`, sub: "Your USDC comes back" };
  return (
    <figure className={`rk-fp ${sale ? "sell" : "buy"}`} aria-label={`What happens on ${when}`}>
      <figcaption>{coin} at settlement, {when}</figcaption>
      <div className="rk-fp-line" aria-hidden="true">
        <span className={`rk-fp-zone below${sale ? "" : " acts"}`} />
        <span className={`rk-fp-zone above${sale ? " acts" : ""}`} />
        <span className="rk-fp-level"><b className="mono">{money(level.strike)}</b></span>
        {at != null && <span className="rk-fp-now" style={{ left: `${at}%` }}><i />now <span className="mono">{money(price)}</span></span>}
      </div>
      <div className="rk-fp-out">
        <div className={sale ? "" : "acts"}><span className="rk-fp-when">Below {money(level.strike)}</span><b>{below.head}</b><small>{below.sub}</small><em className="mono">{plus}</em></div>
        <div className={sale ? "acts" : ""}><span className="rk-fp-when">Above {money(level.strike)}</span><b>{above.head}</b><small>{above.sub}</small><em className="mono">{plus}</em></div>
      </div>
    </figure>
  );
}
