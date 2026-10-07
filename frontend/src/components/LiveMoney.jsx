import { useIndexPrice } from "../lib/livePrice.js";
import { money } from "../lib/questions.js";
import "../live-price.css";

/** A coin's index price in dollars, live from Derive's feed once it answers, else the published one. */
export default function LiveMoney({ und, value, publishedTs = null }) {
  const current = useIndexPrice(und, value, publishedTs);
  const label = current.state === "published" ? "Published" : current.state === "disconnected" ? "Disconnected"
    : current.state === "stale" ? "Stale index" : null;
  return <span className="live-money" title={current.notice} aria-label={`${money(current.price)}. ${current.notice}`}>
    {current.price == null ? "Not available yet" : money(current.price)}
    {label && <small className="live-price-status">{label}</small>}
  </span>;
}
