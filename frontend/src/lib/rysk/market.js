// Rysk's public listing, read over its taker socket (`assets`, `inventory`, `caps`), turned into one
// coin's market on this build's chain: Friday dates, the levels it lists for selling a call (lock the
// coin) or a put (lock USDC), the APR Rysk shows for each, the token each trade locks and Rysk's sizes.
// Pure: no network, so tests feed it saved replies.

const lower = (a) => String(a || "").toLowerCase();
const big = (v) => { try { return BigInt(v); } catch { return 0n; } };

/** Every active token Rysk lists on this chain, by address: symbol, decimals, sizes (contracts, e18). */
export function chainTokens(assets, chainId) {
  const out = new Map();
  for (const t of assets?.[String(chainId)] || []) {
    if (!t?.active || !t.address) continue;
    out.set(lower(t.address), {
      und: t.underlying, symbol: t.symbol, address: t.address, underlying: t.underlyingAssetAddress,
      decimals: Number(t.decimals), min: big(t.minTradeSize), max: big(t.maxTradeSize),
      price: Number(big(t.price)) / 1e18, open: t.marketStatus ? !!t.marketStatus.isOpen : true,
    });
  }
  return out;
}

/** The token a coin's calls lock: the one that is its own underlying (WHYPE, UBTC, UETH, USOL…). */
function mainToken(tokens, und) {
  const mine = [...tokens.values()].filter((t) => t.und === und);
  return mine.find((t) => lower(t.address) === lower(t.underlying)) || mine[0] || null;
}

/**
 * One coin's Rysk market on `net` (lib/rysk/config.js), or null when Rysk lists nothing for it there.
 * {und, token, price, dates: [{expiry, call: [level], put: [level]}]}, dates soonest first, levels low
 * to high. A level: {key, strike, strikeText, expiry, isPut, apr, delta, index, asset, usd, collateral,
 * collateralToken}. Calls lock the coin's main token and pay USDC; puts lock USDC (USDT0 only where
 * Rysk lists no USDC variant).
 */
export function ryskMarket(und, { assets, inventory } = {}, net) {
  if (!net) return null;
  const tokens = chainTokens(assets, net.chainId);
  const token = mainToken(tokens, und);
  const inv = inventory?.[und];
  if (!token || !inv?.combinations) return null;
  const byDate = new Map();
  for (const [key, c] of Object.entries(inv.combinations)) {
    const expiry = Number(c.expiration_timestamp);
    if (!Number.isFinite(expiry) || !(Number(c.strike) > 0)) continue;
    const onChain = (c.products || []).filter((p) => tokens.has(lower(p.asset)) || lower(p.asset) === lower(token.underlying));
    const product = c.isPut
      ? onChain.find((p) => lower(p.collateralAsset) === lower(net.usdc)) || onChain.find((p) => tokens.has(lower(p.asset)))
      : onChain.find((p) => lower(p.collateralAsset) === lower(token.address));
    if (!product) continue;
    const strikeText = key.split("-")[0];
    const level = {
      key, strike: Number(c.strike), strikeText, expiry, isPut: !!c.isPut,
      apr: Number.isFinite(Number(c.apy)) ? Number(c.apy) : null,
      delta: Number.isFinite(Number(c.delta)) ? Number(c.delta) : null,
      index: Number(c.index) || token.price,
      asset: product.asset, usd: product.strikeAsset, collateral: product.collateralAsset,
      collateralToken: c.isPut ? { symbol: lower(product.collateralAsset) === lower(net.usdc) ? "USDC" : "USDT0", decimals: 6, address: product.collateralAsset } : token,
    };
    if (!byDate.has(expiry)) byDate.set(expiry, { expiry, call: [], put: [] });
    byDate.get(expiry)[level.isPut ? "put" : "call"].push(level);
  }
  const dates = [...byDate.values()].sort((a, b) => a.expiry - b.expiry);
  for (const d of dates) for (const side of ["call", "put"]) d[side].sort((a, b) => a.strike - b.strike);
  if (!dates.length) return null;
  const index = dates.flatMap((d) => [...d.call, ...d.put]).find((l) => l.index)?.index || token.price;
  return { und, token, price: index, dates };
}

/** Coins Rysk lists on this build's chain, in Rysk's order. */
export function ryskCoins(listing, net) {
  return Object.keys(listing?.inventory || {}).filter((und) => ryskMarket(und, listing, net));
}

/** The date closest to a settlement time (the Saloon's chosen date), else the first. */
export function nearestDate(market, ts) {
  if (!market?.dates.length) return null;
  if (!Number.isFinite(ts)) return market.dates[0];
  return market.dates.reduce((best, d) => (Math.abs(d.expiry - ts) < Math.abs(best.expiry - ts) ? d : best), market.dates[0]);
}

/** The level on that date and side closest to a price, else the one nearest the coin's price. */
export function nearestLevel(levels, price) {
  if (!levels?.length) return null;
  if (!Number.isFinite(price)) return levels[0];
  return levels.reduce((best, l) => (Math.abs(l.strike - price) < Math.abs(best.strike - price) ? l : best), levels[0]);
}

/**
 * What Rysk still takes for this trade (its caps reply): the smallest room left among the caps that
 * apply (everything, the coin, the token, the token's side), in contracts and in dollars (e18 each);
 * null where no cap applies.
 */
export function capsRoom(caps, level, und) {
  const names = new Set(["global", lower(und), lower(level.asset), lower(level.collateral), `${lower(level.asset)}-${level.isPut}`]);
  let contracts = null, notional = null;
  for (const c of caps || []) {
    if (!names.has(lower(c.name))) continue;
    const room = big(c.cap) - big(c.usage);
    const left = room > 0n ? room : 0n;
    if (c.type === "CONTRACTS") contracts = contracts == null || left < contracts ? left : contracts;
    if (c.type === "NOTIONAL") notional = notional == null || left < notional ? left : notional;
  }
  return { contracts, notional };
}

/**
 * About what Rysk's smallest size of a level pays now, in dollars, from Rysk's listed APR: the yearly
 * rate on what the trade locks (the coin at its price for a sale; the cash at the level for a purchase),
 * for the days left. Measured against one firm quote on 10 October 2026 (0.5 ETH at $2,550: listed
 * 67.85% gave $13.07, the firm premium was $13.07). The firm premium comes from Rysk's makers.
 */
export function premiumEstimate(level, market, nowSec) {
  if (!level || level.apr == null || !market) return null;
  const days = (level.expiry - nowSec) / 86400;
  if (!(days > 0)) return null;
  const size = Number(market.token.min) / 1e18;
  const basis = level.isPut ? size * level.strike : size * (level.index || market.price);
  return (level.apr / 100) * basis * (days / 365);
}
