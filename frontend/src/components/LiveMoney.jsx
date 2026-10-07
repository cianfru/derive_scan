import { useLivePrice } from "../lib/livePrice.js";
import { money } from "../lib/questions.js";

/** A coin's index price in dollars, live from Derive's feed once it answers, else the published one. */
export default function LiveMoney({ und, value }) {
  const lp = useLivePrice(und);
  return money(lp?.price || value);
}
