// Testnet builds only: is a Saloon level listed on Derive's testnet? The board comes from mainnet
// chains, and the testnet lists other strikes, so a level can be missing there. The list itself is
// read in the trade chunk (lib/trade/listing.js); every other build drops the read (TESTNET_FILLS is a
// build-time constant) and the hook answers null.
import { useEffect, useState } from "react";
import { TESTNET_FILLS } from "./flags.js";
import { parseId } from "./questions.js";
import { packageLegs } from "./trade/package.js";

export const NOT_ON_TESTNET = "Not on testnet";
export const NOT_ON_TESTNET_WHY = "Prices here come from Derive's live market. One-tap trades in this build go to Derive's testnet, which lists other strikes, and it does not list the options for this level. Pick another level.";

/**
 * The instruments an answer needs that `listed` (a Set of names) lacks. Empty when all are listed,
 * and when the list is unknown (null): a failed read blocks nothing.
 */
export function missingLegs(levelId, side, listed) {
  if (!listed) return [];
  const p = parseId(levelId);
  if (!p || (side !== "yes" && side !== "no")) return [];
  return packageLegs({ und: p.und, expiry: p.expiry, kind: side, lo: p.lo, hi: p.hi })
    .map((l) => l.instrument_name).filter((n) => !listed.has(n));
}

const load = TESTNET_FILLS ? (und) => import("../components/trade/TradePanel.jsx").then((m) => m.testnetListing(und), () => null) : null;

/** The testnet's instrument list for `und` (a Set), or null: not a testnet build, not loaded yet, or the read failed. */
export function useTestnetListing(und) {
  const [listed, setListed] = useState(null);
  useEffect(() => {
    if (!load || !und) return undefined;
    let live = true;
    load(und).then((s) => { if (live) setListed(s || null); });
    return () => { live = false; };
  }, [und]);
  return listed;
}
