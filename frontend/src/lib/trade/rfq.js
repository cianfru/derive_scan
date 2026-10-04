// Saloon stage 2, P5: the dry run. Ask Derive for a firm price on the whole package (send_rfq), re-read
// the best quote, check it, and on the user's tap sign the execution and send it only to Derive's
// public/execute_quote_debug, which checks the signed bytes and fills nothing. The RFQ is always
// cancelled when the ticket closes. This module has no path to private/execute_quote.
import { EXTRA_FEE, FIRM_MS, NETWORK, PARTIAL_FILL_STEP, POLL_MS, QUOTE_WAIT_MS, REFERRAL } from "./config.js";
import { checkQuote, packageCost } from "./package.js";
import { buildExecute, debugMatches, randomNonce } from "./sign.js";
import { checkIncidents, plainError } from "./derive.js";

const secs = (t) => (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)); // Derive times can be ms

/** Signature expiry for a taker execution: at least 60 s past the RFQ's own expiry, at most a day. */
export function executeExpiry(nowSec, validUntil) {
  const floor = validUntil ? secs(validUntil) + 120 : nowSec + 1900;
  return Math.min(Math.max(nowSec + 700, floor), nowSec + 86_000);
}

/**
 * One ticket's dry run. `legs` are wire legs (instrument_name, direction, amount); `direction` is the
 * user's side ("buy", or "sell" to sell back); `limit` is max_total_cost (buy) or min_total_cost (sell).
 * `onChange(state)` gets every new state.
 */
export function createDryRun({
  client, getInstrument, subaccountId, owner, key, legs, direction, limit, payout, feeEstimate, label,
  referral = REFERRAL, chainId = NETWORK.chainId, onChange = () => {}, now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), unschedule = (t) => clearTimeout(t), makeNonce = randomNonce,
}) {
  let state = { phase: "idle" };
  let rfq = null;
  let timer = null;
  let started = 0;
  let closed = false;
  let instruments = {};
  const set = (patch) => { state = { ...state, ...patch }; onChange(state); };
  const stop = () => { if (timer) unschedule(timer); timer = null; };

  async function cancel() {
    const id = rfq?.rfq_id;
    if (!id || rfq.cancelled) return;
    rfq.cancelled = true;
    try { await client.call("private/cancel_rfq", { subaccount_id: subaccountId, rfq_id: id }); } catch { /* it expires by itself */ }
  }

  async function start() {
    stop();
    await cancel();
    rfq = null;
    set({ phase: "asking", quote: null, check: null, message: null, debug: null, firmUntil: null });
    if (await checkIncidents(client) === "down") return set({ phase: "down", message: plainError({ code: 9002 }) });
    try {
      const facts = await Promise.all(legs.map((l) => getInstrument(l.instrument_name)));
      instruments = Object.fromEntries(facts.map((f) => [f.instrument_name, f]));
    } catch {
      return set({ phase: "no_quote", message: "No price from Derive right now." });
    }
    if (closed) return;
    const params = {
      subaccount_id: subaccountId, legs, label, partial_fill_step: PARTIAL_FILL_STEP, extra_fee: EXTRA_FEE,
      ...(direction === "buy" ? { max_total_cost: String(limit) } : { min_total_cost: String(limit) }),
      ...(referral ? { referral_code: referral } : {}),
    };
    try {
      rfq = await client.call("private/send_rfq", params);
    } catch (e) {
      return set({ phase: "error", message: plainError(e) });
    }
    if (closed) return cancel();
    started = now();
    poll();
  }

  async function poll() {
    timer = null;
    if (closed || !rfq) return;
    let res;
    try {
      res = await client.call("private/rfq_get_best_quote", { subaccount_id: subaccountId, rfq_id: rfq.rfq_id, direction, legs });
    } catch (e) {
      if (closed) return;
      stop();
      await cancel();
      return set({ phase: "error", message: plainError(e) });
    }
    if (closed) return;
    const t = now();
    const best = res?.best_quote;
    if (!best || best.status !== "open") {
      if (state.phase === "quoted") return lapse(); // the quote was pulled
      if (t - started >= QUOTE_WAIT_MS) {
        await cancel();
        return set({ phase: "no_quote", message: "No price from Derive right now." });
      }
      timer = schedule(poll, POLL_MS);
      return;
    }
    const check = checkQuote(res, { direction, payout, limit, feeEstimate });
    if (!check.ok) {
      await cancel();
      return set({ phase: check.reason === "beyond" ? "beyond" : "blocked", check, quote: best, message: null });
    }
    const fresh = best.quote_id !== state.quote?.quote_id;
    set({ phase: "quoted", quote: best, check, best: res, firmUntil: fresh ? t + FIRM_MS : state.firmUntil, changed: fresh && !!state.quote });
    if (t >= state.firmUntil) return lapse();
    timer = schedule(poll, POLL_MS);
  }

  async function lapse() {
    stop();
    await cancel();
    set({ phase: "lapsed" });
  }

  /**
   * The user's tap, carrying the exact total they saw. If the quote changed since, nothing is signed
   * and the new number waits for a fresh tap. Otherwise the execution is signed with the Saloon key
   * and checked by public/execute_quote_debug; nothing fills, and the RFQ is cancelled.
   */
  async function confirm(shownTotal) {
    if (state.phase !== "quoted" || now() >= state.firmUntil) return lapse();
    if (Math.abs(state.check.total - shownTotal) > 0.005) return set({ changed: true });
    stop();
    set({ phase: "checking" });
    const nowS = Math.floor(now() / 1000);
    let built;
    try {
      built = buildExecute({
        quote: state.quote, subaccountId, owner, key, instruments, maxFee: state.best.suggested_max_fee, chainId,
        nonce: makeNonce(now()), expirySec: executeExpiry(nowS, rfq?.valid_until), referral, label,
      });
      const remote = await client.call("public/execute_quote_debug", built.payload);
      const match = debugMatches(built.local, remote);
      set({ phase: "checked", debug: { ...match, legsTotal: packageCost(state.quote.legs) } });
    } catch (e) {
      set({ phase: "error", message: plainError(e) });
    } finally {
      await cancel();
    }
  }

  async function close() {
    closed = true;
    stop();
    await cancel();
    set({ phase: "closed" });
  }

  return { start, confirm, close, get state() { return state; }, get rfqId() { return rfq?.rfq_id || null; } };
}
