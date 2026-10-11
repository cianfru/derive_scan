// Selling an option on Rysk from the user's own wallet, the way Rysk's trade page does it: the wallet
// approves the collateral to Rysk's margin pool (only when its allowance is short), Rysk prices its gas
// fee, the wallet signs one confirmation, and Rysk sends the trade on HyperEVM; the premium lands in the
// wallet. Each step is timed (owner, 10 October 2026: "we should actually chrono this time"). Nothing is
// sent twice: a confirmation whose answer never came is reported as unknown, never resent.
import { Interface, getAddress } from "ethers";
import { signTypedData, switchFundingChain } from "../trade/wallet.js";
import { collateralUnits, confirmationBody, confirmationTypedData, echoes, premiumUnits } from "./order.js";

const erc20 = /* @__PURE__ */ new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export const STEPS = [
  ["network", "Wallet on HyperEVM"],
  ["check", "Checks"],
  ["approve", "Approve collateral"],
  ["fee", "Rysk's gas fee"],
  ["sign", "Sign the trade"],
  ["send", "Rysk sends it"],
  ["settle", "Confirmed on HyperEVM"],
];

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const ask = async (provider, method, params) => provider.request({ method, params });

export async function tokenBalance(provider, token, wallet) {
  return BigInt(await ask(provider, "eth_call", [{ to: token, data: erc20.encodeFunctionData("balanceOf", [wallet]) }, "latest"]));
}
export const nativeBalance = async (provider, wallet) => BigInt(await ask(provider, "eth_getBalance", [wallet, "latest"]));

async function receipt(provider, hash, { tries, sleep }) {
  for (let i = 0; i < tries; i++) {
    const r = await ask(provider, "eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await sleep(1000);
  }
  return null;
}

/**
 * Lock the collateral and receive the premium. `quote()` returns the latest firm quote that fits the
 * request (waiting for one if needed); `allow()` re-reads whether fills may go out now (mainnet: the
 * published switch and the pilot list) and returns true or a message. `onStep(key, {status, ms})`
 * reports each step as it starts and ends.
 */
export async function lockAndReceive({
  provider, wallet, net, socket, level, quote, allow = async () => true, shownPremium, onStep = () => {},
  fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), receiptTries = 120,
}) {
  const timings = {};
  const started = now();
  let current = null, t0 = 0;
  const begin = (k) => { current = k; t0 = now(); onStep(k, { status: "active" }); };
  const end = (k, status = "done") => { timings[k] = now() - t0; onStep(k, { status, ms: timings[k] }); current = null; };
  const gate = async () => {
    const ok = await allow();
    if (ok !== true) throw fail("rysk_closed", typeof ok === "string" ? ok : "Trading on Rysk is closed right now.");
  };
  try {
    begin("network");
    await switchFundingChain(provider, wallet, { id: net.chainId, metamask: net.metamask });
    end("network");

    begin("check");
    await gate();
    let q = await quote();
    const amount = collateralUnits(BigInt(q.quantity), level);
    const [held, gas] = await Promise.all([tokenBalance(provider, q.collateralAsset, wallet), nativeBalance(provider, wallet)]);
    if (held < amount) throw fail("rysk_collateral", `Your wallet holds less ${level.collateralToken.symbol} than this trade locks.`, { need: amount, held });
    if (gas <= 0n) throw fail("rysk_gas", "Your wallet needs a little HYPE on HyperEVM for the approval.");
    end("check");

    begin("approve");
    const allowed = BigInt(await ask(provider, "eth_call", [{ to: q.collateralAsset, data: erc20.encodeFunctionData("allowance", [wallet, net.marginPool]) }, "latest"]));
    if (allowed >= amount) end("approve", "skipped");
    else {
      const hash = await ask(provider, "eth_sendTransaction", [{ from: wallet, to: q.collateralAsset, data: erc20.encodeFunctionData("approve", [getAddress(net.marginPool), amount]) }]);
      const r = await receipt(provider, hash, { tries: receiptTries, sleep });
      if (!r) throw fail("rysk_approve_pending", "The approval is still pending. Check your wallet before trying again.", { approveHash: hash });
      if (Number(r.status) !== 1) throw fail("rysk_approve_failed", "The approval failed on HyperEVM.", { approveHash: hash });
      end("approve");
    }

    begin("fee");
    q = await quote(); // the approval may have outlived the first quote
    const premium = premiumUnits(q);
    if (shownPremium != null && premium * 100n < BigInt(shownPremium) * 99n) {
      throw fail("rysk_premium_changed", "The premium changed. Check it and confirm again.", { quote: q });
    }
    const body = confirmationBody(q, { taker: wallet, collateralAmount: collateralUnits(BigInt(q.quantity), level), nonce: now() });
    const res = await fetchImpl(`${net.apiUrl}/api/gas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const reply = res.ok ? await res.json() : null;
    if (!echoes(body, reply)) throw fail("rysk_fee", "Rysk did not price its gas fee for this trade.");
    const gasFee = BigInt(reply.gasFee || "0");
    if (gasFee >= premium) throw fail("rysk_fee_over_premium", "Rysk's gas fee is larger than the premium. Choose a larger amount.");
    end("fee");

    begin("sign");
    const signature = await signTypedData(provider, wallet, confirmationTypedData(body, gasFee, net));
    end("sign");

    begin("send");
    await gate(); // re-read right before anything leaves the browser
    let hash;
    try {
      hash = await socket.call("confirm", { ...reply, gasFee: gasFee.toString(), isEIP1271: false, signature }, { timeout: 90_000 });
    } catch (e) {
      if (e?.code === "rysk_timeout" || e?.code === "rysk_closed") throw fail("rysk_unknown", "Rysk did not say whether the trade went through. Check your positions before trying again.", { unknown: true });
      throw e;
    }
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) throw fail("rysk_unknown", "Rysk's answer carried no transaction. Check your positions before trying again.", { unknown: true });
    end("send");

    begin("settle");
    const r = await receipt(provider, hash, { tries: receiptTries, sleep });
    if (!r) throw fail("rysk_pending", "The trade is still pending on HyperEVM.", { hash, unknown: true });
    if (Number(r.status) !== 1) throw fail("rysk_reverted", "The trade failed on HyperEVM; nothing was locked.", { hash });
    end("settle");

    return {
      hash, premium, gasFee, received: premium - gasFee, quote: q, body, timings, totalMs: now() - started,
      collateralAmount: BigInt(body.collateralAmount),
    };
  } catch (e) {
    if (current) end(current, "failed");
    e.timings = timings;
    e.totalMs = now() - started;
    throw e;
  }
}

/** HYPE's wrapped token on HyperEVM (and its testnet): what selling HYPE at a level locks. */
export const WHYPE = "0x5555555555555555555555555555555555555555";

/**
 * Wrap native HYPE into WHYPE (WHYPE's deposit(), one wallet transaction), so a sale at a level can lock
 * it. Moves the wallet to the build's chain first; waits for the receipt and never sends twice.
 */
export async function wrapHype({ provider, wallet, net, units, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), receiptTries = 120 }) {
  await switchFundingChain(provider, wallet, { id: net.chainId, metamask: net.metamask });
  const hash = await ask(provider, "eth_sendTransaction", [{ from: wallet, to: WHYPE, value: `0x${BigInt(units).toString(16)}`, data: "0xd0e30db0" }]);
  const r = await receipt(provider, hash, { tries: receiptTries, sleep });
  if (!r) throw fail("rysk_wrap_pending", "Wrapping is still pending. Check your wallet before trying again.", { hash });
  if (Number(r.status) !== 1) throw fail("rysk_wrap_failed", "Wrapping failed on HyperEVM.", { hash });
  return hash;
}
