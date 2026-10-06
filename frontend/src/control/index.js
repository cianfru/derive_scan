import { ORIGINAL } from "./cards.jsx";
import { MARKET } from "./cards/market.jsx";
import { OPTIONS } from "./cards/options.jsx";
import { SALOON } from "./cards/saloon.jsx";
import { TRADERS } from "./cards/traders.jsx";

export const GROUPS = ["Market", "Coins", "Options", "Saloon", "Traders"];
export const CATALOGUE = [...ORIGINAL, ...MARKET, ...OPTIONS, ...SALOON, ...TRADERS];

/** Every card and coin as its own entry: {key, card, param}. */
export const ENTRIES = CATALOGUE.flatMap((card) => (card.params || [null]).map((param) => ({ key: param ? `${card.id}-${param}` : card.id, card, param })));

/** Builds a card's model from its files, loading any extra file the first pass asks for. */
export async function buildModel(card, param, load) {
  const files = await Promise.all(card.files(param).map((f) => load(f)));
  let m = card.model(files, param);
  if (m && m.need) m = m.then(await Promise.all(m.need.map((f) => load(f))));
  return m || null;
}
