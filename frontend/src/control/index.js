import { ORIGINAL } from "./cards.jsx";
import { MARKET } from "./cards/market.jsx";
import { OPTIONS } from "./cards/options.jsx";
import { SALOON } from "./cards/saloon.jsx";
import { TRADERS } from "./cards/traders.jsx";
import { eligibleDocument } from "./eligibility.js";
import { publicationState } from "../lib/publication.js";

export const GROUPS = ["Market", "Coins", "Options", "Saloon", "Traders"];
export const CATALOGUE = [...ORIGINAL, ...MARKET, ...OPTIONS, ...SALOON, ...TRADERS];

/** Every card and coin as its own entry: {key, card, param}. */
export const ENTRIES = CATALOGUE.flatMap((card) => (card.params || [null]).map((param) => ({ key: param ? `${card.id}-${param}` : card.id, card, param })));

/** Builds a card's model from its files, loading any extra file the first pass asks for. */
export async function buildModel(card, param, load) {
  const paths = [...card.files(param)];
  const raw = await Promise.all(paths.map((f) => load(f)));
  const known = CATALOGUE.some((c) => c.id === card.id);
  const now = Date.now() / 1000;
  const primaryCount = paths.length;
  let extraPaths = [], extra = [];
  const files = known ? raw.map((d, i) => eligibleDocument(paths[i], d, card, now)) : raw;
  if (files.some((d) => !d)) return null;
  if (publicationState(raw).mismatch) throw new Error("Snapshot files are from different publications. Try again shortly.");
  let m = card.model(files, param);
  if (m && m.need) {
    const morePaths = [...m.need];
    const more = await Promise.all(morePaths.map((f) => load(f)));
    if (publicationState([...raw, ...more]).mismatch) throw new Error("Snapshot files are from different publications. Try again shortly.");
    const moreInputs = known ? more.map((d, i) => eligibleDocument(morePaths[i], d, card, now)) : more;
    if (known && moreInputs.some((d) => !d)) return null;
    paths.push(...morePaths); raw.push(...more);
    extraPaths = morePaths; extra = more;
    m = m.then(moreInputs);
  }
  if (m && known) {
    const baseline = JSON.stringify(m);
    m = { ...m, provenance: { revision: publicationState(raw).revision,
      sources: paths.map((path, i) => ({ path, observedAt: raw[i].prices_ts ?? raw[i].options?.ts ?? raw[i].generated_at ?? null })),
      eligible: () => {
        const clock = Date.now() / 1000;
        const inputs = raw.slice(0, primaryCount).map((d, i) => eligibleDocument(paths[i], d, card, clock));
        if (inputs.some((d) => !d)) return false;
        let current = card.model(inputs, param);
        if (current?.need) {
          if (JSON.stringify(current.need) !== JSON.stringify(extraPaths)) return false;
          const additional = extra.map((d, i) => eligibleDocument(extraPaths[i], d, card, clock));
          if (additional.some((d) => !d)) return false;
          current = current.then(additional);
        }
        return !!current && JSON.stringify(current) === baseline;
      },
    } };
  }
  return m || null;
}
