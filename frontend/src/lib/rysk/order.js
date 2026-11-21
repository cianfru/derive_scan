// A Rysk trade in numbers: the quote request, the collateral it locks, the premium a firm quote pays,
// and the confirmation the wallet signs. Pure. Wire formats follow Rysk's own trade page (read
// 10 October 2026): quantity in contracts with 18 decimals, strike with 8, price per contract in
// dollars with 18, Rysk's gas fee in the premium token's 6 decimals.
import { getAddress, parseUnits } from "ethers";

export const E18 = 10n ** 18n;
const lower = (a) => String(a || "").toLowerCase();
const big = (v) => { try { return BigInt(v); } catch { return null; } };

/** A decimal string of contracts ("0.5") in e18, or null when it is not a number. */
export function contracts(text) {
  const s = String(text ?? "").trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  try { return parseUnits(s.endsWith(".") ? s.slice(0, -1) : s, 18); } catch { return null; }
}
export const strikeE8 = (level) => parseUnits(String(level.strikeText ?? level.strike), 8);

/** Rysk's size rule: a whole number of its minimum size, between its minimum and maximum. */
export function snapSize(q, min, max) {
  if (q == null || min <= 0n) return null;
  let n = q < min ? min : q;
  if (max > 0n && n > max) n = max;
  n -= n % min;
  return n < min ? min : n;
}

/** The collateral a trade locks, in the token's own units: a put locks strike x contracts of USDC (6
 * decimals); a call locks the contracts in the coin's token. */
export function collateralUnits(quantity, level) {
  if (level.isPut) return (quantity * strikeE8(level) * 10n ** 10n) / 10n ** 30n;
  const dec = Number(level.collateralToken?.decimals ?? 18);
  return quantity / 10n ** BigInt(18 - dec);
}

/** Dollars from base units of a token with `decimals`. */
export const toNumber = (units, decimals) => Number(units) / 10 ** decimals;

/** The premium a quote pays, in the premium token's 6-decimal units (quantity x price / 1e30). */
export const premiumUnits = (q) => (big(q.quantity) ?? 0n) * (big(q.price) ?? 0n) / 10n ** 30n;

/** The quote request, as Rysk's trade page sends it. The taker may be the zero address before a wallet
 * is connected: Rysk's quotes do not depend on who takes them. */
export function requestParams(level, quantity, taker, net, assetName = level.collateralToken?.symbol) {
  return {
    asset: level.asset, assetName, chainId: net.chainId, expiry: level.expiry, isPut: level.isPut,
    quantity: quantity.toString(), strike: strikeE8(level).toString(),
    taker: taker || "0x0000000000000000000000000000000000000000", usd: level.usd, collateralAsset: level.collateral, isEIP1271: false,
  };
}

/** Is this firm quote for exactly what was asked, still valid for at least `margin` seconds, and a
 * sale (the maker buys)? Anything else is ignored. */
export function quoteFits(quote, req, nowSec, margin = 3) {
  if (!quote || typeof quote !== "object") return false;
  const same = (a, b) => big(a) != null && big(a) === big(b);
  return lower(quote.assetAddress) === lower(req.asset) && lower(quote.collateralAsset) === lower(req.collateralAsset)
    && lower(quote.usd) === lower(req.usd) && same(quote.chainId, req.chainId) && same(quote.expiry, req.expiry)
    && !!quote.isPut === !!req.isPut && same(quote.strike, req.strike) && same(quote.quantity, req.quantity)
    && quote.isTakerBuy === false && (big(quote.price) ?? 0n) > 0n && Number(quote.validUntil) > nowSec + margin
    && /^0x[0-9a-f]{40}$/i.test(quote.maker || "") && /^0x[0-9a-f]+$/i.test(quote.signature || "");
}

/** The body Rysk's gas-fee endpoint takes and echoes, then the confirmation is signed over: the quote
 * as received, the taker, the collateral and a millisecond nonce. */
export function confirmationBody(quote, { taker, collateralAmount, nonce }) {
  return {
    assetAddress: quote.assetAddress, chainId: quote.chainId, expiry: quote.expiry, isPut: quote.isPut, isTakerBuy: false,
    maker: quote.maker, price: quote.price, quantity: quote.quantity, quoteNonce: quote.nonce, quoteSignature: quote.signature,
    quoteValidUntil: quote.validUntil, strike: quote.strike, taker: getAddress(taker), validUntil: quote.validUntil, usd: quote.usd,
    collateralAsset: quote.collateralAsset, collateralAmount: collateralAmount.toString(), nonce: String(nonce),
  };
}

const SIGNED = ["assetAddress", "chainId", "expiry", "isPut", "isTakerBuy", "maker", "nonce", "price", "quantity", "quoteNonce", "quoteSignature", "strike", "taker", "usd", "collateralAsset", "collateralAmount"];
/** The gas-fee reply must echo every signed field of what was sent (it is sent back with the signature). */
export function echoes(body, reply) {
  if (!reply || typeof reply !== "object") return false;
  return SIGNED.every((k) => String(reply[k]).toLowerCase() === String(body[k]).toLowerCase());
}

/** EIP-712 types exactly as Rysk's trade page signs them. */
export const CONFIRMATION_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
  ],
  Confirmation: [
    { name: "maker", type: "address" }, { name: "assetAddress", type: "address" }, { name: "chainId", type: "uint256" },
    { name: "expiry", type: "uint64" }, { name: "isPut", type: "bool" }, { name: "nonce", type: "uint64" },
    { name: "price", type: "uint256" }, { name: "quantity", type: "uint256" }, { name: "quoteNonce", type: "uint64" },
    { name: "quoteSignature", type: "bytes" }, { name: "strike", type: "uint256" }, { name: "taker", type: "address" },
    { name: "isTakerBuy", type: "bool" }, { name: "usd", type: "address" }, { name: "collateralAsset", type: "address" },
    { name: "collateralAmount", type: "uint256" }, { name: "gasFee", type: "uint256" },
  ],
};

/** The typed data the wallet signs: the confirmation with Rysk's gas fee, on this build's domain. */
export function confirmationTypedData(body, gasFee, net) {
  const n = (v) => BigInt(v).toString();
  return {
    domain: { name: "rysk", version: "0.0.0", chainId: net.chainId, verifyingContract: net.rysk },
    types: CONFIRMATION_TYPES,
    primaryType: "Confirmation",
    message: {
      maker: body.maker, assetAddress: body.assetAddress, chainId: n(body.chainId), expiry: n(body.expiry), isPut: !!body.isPut,
      nonce: n(body.nonce), price: n(body.price), quantity: n(body.quantity), quoteNonce: n(body.quoteNonce),
      quoteSignature: body.quoteSignature, strike: n(body.strike), taker: body.taker, isTakerBuy: false, usd: body.usd,
      collateralAsset: body.collateralAsset, collateralAmount: n(body.collateralAmount), gasFee: n(gasFee || "0"),
    },
  };
}
