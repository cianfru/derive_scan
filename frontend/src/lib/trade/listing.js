// Saloon stage 2, testnet builds: which option instruments Derive's V3 testnet lists. The board is
// built from mainnet chains and the testnet lists other strikes, so a level can be missing there.
// Read once per page per coin (public/get_all_instruments, paginated) over the seat's connection or a
// public one; a failed read answers null and blocks nothing.
import { TRADE_COINS } from "./config.js";
import { publicClient } from "./seat.js";

const cache = new Map();
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/** Every live option instrument name for `und` on the client's network. */
export async function listedInstruments(client, und) {
  const names = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const r = await client.call("public/get_all_instruments", { currency: und, instrument_type: "option", expired: false, page, page_size: PAGE_SIZE });
    for (const i of r?.instruments || []) names.add(i.instrument_name);
    const pages = Number(r?.pagination?.num_pages);
    if (!(Number.isFinite(pages) && page < pages)) break;
  }
  return names;
}

/** The testnet's listed instruments for `und` (a Set), or null when unknown or the read failed. Cached per page. */
export function testnetListing(und) {
  if (!(TRADE_COINS === "all" ? /^[A-Z0-9]+$/.test(und || "") : TRADE_COINS.includes(und))) return Promise.resolve(null);
  if (!cache.has(und)) {
    let p;
    try {
      p = listedInstruments(publicClient(), und).then((s) => (s.size ? s : null), () => null);
    } catch {
      p = Promise.resolve(null);
    }
    p.then((s) => { if (!s) cache.delete(und); }); // a failed read is tried again later
    cache.set(und, p);
  }
  return cache.get(und);
}

export function _resetListing() { cache.clear(); }
