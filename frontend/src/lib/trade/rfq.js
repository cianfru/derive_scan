// Saloon stage 2: one ticket's trip through Derive's RFQ. Ask Derive for a firm price on the whole
// package (send_rfq), re-read the best quote, check it, and on the user's tap sign the execution
// with the Saloon key.
//   P5, the dry run ("dryrun" builds): the signed execution goes only to public/execute_quote_debug,
//   which checks the bytes and fills nothing; the RFQ is cancelled.
//   P6, testnet fills ("testnet" builds, owner's approval 4 October 2026): the signed execution goes
//   to private/execute_quote on Derive's V3 testnet, never anywhere else (fillsAllowed here, and the
//   client refuses it on any other endpoint). The fill is read back from Derive's trade history.
//   P8, real money ("mainnet" builds): the same path on Derive's V3 mainnet, open only to pilot
//   wallets while the published mainnet switch allows it; the switch is read again, fresh, right
//   before the fill, and an unreadable switch counts as off.
// The kill switch and the caps are checked before the RFQ and again before the fill. A tap with no
// clear answer is never re-sent: the RFQ is re-read until Derive says what happened.
import {
  BOOK_ASKS, CHECK_MS, CHECK_TRIES, EXTRA_FEE, FIRM_MS, MODE, NETWORK, PARTIAL_FILL_STEP, POLL_MS, QUOTE_WAIT_MS, REFERRAL, fillsAllowed,
} from "./config.js";
import { TRADE_LIMITS, checkQuote, packageCost, quoteMatchesPlan } from "./package.js";
import { buildExecute, debugMatches, domainSeparator, randomNonce } from "./sign.js";
import { CANCEL_PLAIN, EXECUTE, MAINNET_GUARD, SOCKET_CLOSED, TIMEOUT, checkIncidents, deriveKeyRejected, errorDetail, failure, plainError } from "./derive.js";
import { fillComplete, fillFromExecute, fillFromTrades, tradesOf, userSide } from "./fills.js";
import { TRADING_NOTICE, addSpent, capGate, capMessage, tradingAllows } from "./limits.js";
import { mainnetOpen, setMainnetSwitch } from "./live.js";
import { MAINNET_FILLS } from "../flags.js";
import { isPilot } from "../pilot.js";

/** Fills go only where this build points: the right mode, network, endpoint and signing domain. */
const FILL_MODES = ["testnet", "mainnet"];
/** Real money, a wallet outside the pilot: never a request. */
export const PILOT_ONLY = "One-tap trading is open to a few test wallets for now. Place the orders by hand on Derive.";

const secs = (t) => (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)); // Derive times can be ms

/** Signature expiry for a taker execution: at least 60 s past the RFQ's own expiry, at most a day. */
export function executeExpiry(nowSec, validUntil) {
  const floor = validUntil ? secs(validUntil) + 120 : nowSec + 1900;
  return Math.min(Math.max(nowSec + 700, floor), nowSec + 86_000);
}

/** Plain messages for the ways a fill can end without one. */
export const OUTCOME = {
  expired: "That price is no longer open. Nothing was bought or sold.",
  busy: "Derive is busy right now. Nothing was bought or sold. Try again in a moment.",
  not_filled: "Derive did not fill it. Nothing was bought or sold.",
  unknown: "Derive has not confirmed this trade yet, and Cowboy never sends it twice. Check Positions in a minute.",
};
/** A leg the network does not list (Derive's 12001 "Instrument not found"). */
export const NOT_FOUND = 12001;
export const NOT_LISTED = MAINNET_FILLS ? "Derive doesn't list this level. Pick another level." : "Derive's testnet doesn't list this level. Pick another level.";
const EXPIRED_CODES = new Set([11104, 11102, 11011]);
const BUSY_CODES = new Set([-32000, 9002, -32100]);
const UNKNOWN_CODES = new Set([TIMEOUT, SOCKET_CLOSED, 9000, 9001]);

/**
 * One ticket. `legs` are wire legs (instrument_name, direction, amount) as the package is bought;
 * `direction` is the user's side ("buy", or "sell" to sell back); `limit` is max_total_cost (buy) or
 * min_total_cost (sell), or null for a sell back with no board price, which then takes its floor
 * from Derive's mark. `estimate` is the board's most-you-can-lose, for the caps before any RFQ.
 * `trading()` reads the kill switch. `onFill(fill)` gets every fill once, before the screen changes.
 * `onKeyRejected()` is called when Derive no longer takes the Saloon key (the seat drops it and asks
 * for a fresh approval). On mainnet, `readSwitch()` reads the published mainnet switch afresh right
 * before the fill (a failed read counts as off), and only pilot wallets get as far as a request.
 */
export function createTicket({
  client, getInstrument, subaccountId, owner, wallet = owner, key, legs, direction, limit, payout, feeEstimate, label,
  estimate = null, tolerance = TRADE_LIMITS.tolerance.major, mode = MODE, network = NETWORK, trading = () => "on", onFill = () => {}, onKeyRejected = () => {},
  readSwitch = async () => "off",
  referral = REFERRAL, chainId = network?.chainId ?? NETWORK.chainId, onChange = () => {}, now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), unschedule = (t) => clearTimeout(t), makeNonce = randomNonce,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let state = { phase: "idle" };
  let rfq = null;
  let timer = null;
  let started = 0;
  let closed = false;
  let filled = false;
  let instruments = {};
  let floor = limit;
  const planned = Object.fromEntries(legs.map((l) => [l.instrument_name, Number(l.amount)]));
  const set = (patch) => { state = { ...state, ...patch }; onChange(state); };
  const stop = () => { if (timer) unschedule(timer); timer = null; };
  const tapStep = direction === "buy" ? "buy" : "sell";
  const beforeSend = () => {
    if (closed) throw Object.assign(new Error("Ticket closed"), { name: "AbortError" });
  };
  /** Derive refused the key itself: the seat hears it once. */
  const keyCheck = (e) => { if (deriveKeyRejected(e)) { try { onKeyRejected(); } catch { /* the screen still says it */ } } };

  async function cancel() {
    const id = rfq?.rfq_id;
    if (!id || rfq.cancelled || filled) return;
    rfq.cancelled = true;
    try { await client.call("private/cancel_rfq", { subaccount_id: subaccountId, rfq_id: id }); } catch { /* it expires by itself */ }
  }

  /** The kill switch and, for a buy, the caps. Returns a state patch when blocked. */
  function gate(mostLose) {
    if (mode === "mainnet" && !isPilot(wallet)) return { phase: "paused", message: PILOT_ONLY };
    const t = trading();
    if (!tradingAllows(t, direction)) return { phase: "paused", message: TRADING_NOTICE[t] || TRADING_NOTICE.off };
    if (direction === "buy" && mostLose != null) {
      const c = capGate(mostLose, wallet, now());
      if (!c.ok) return { phase: "capped", cap: c, message: capMessage(c) };
    }
    return null;
  }

  let attempt = 0;
  /** `again`: Cowboy's own new request after the order book beat every quote (never the user's tap). */
  async function start({ again = false } = {}) {
    if (closed) return;
    attempt = again ? attempt + 1 : 1;
    stop();
    await cancel();
    if (closed) return;
    rfq = null;
    filled = false;
    set({ phase: "asking", attempt, attempts: BOOK_ASKS, quote: null, check: null, message: null, detail: null, debug: null, firmUntil: null, fill: null, cap: null });
    const blocked = gate(estimate);
    if (blocked) return set(blocked);
    const incidents = await checkIncidents(client);
    if (closed) return;
    if (incidents === "down") return set({ phase: "down", message: plainError({ code: 9002 }) });
    const facts = await Promise.allSettled(legs.map((l) => getInstrument(l.instrument_name)));
    const missing = legs.filter((l, i) => facts[i].status === "rejected" && facts[i].reason?.code === NOT_FOUND).map((l) => l.instrument_name);
    if (missing.length) {
      // The board comes from mainnet chains; the testnet lists other strikes. Asking again cannot help.
      if (closed) return;
      const e = facts.find((f) => f.status === "rejected").reason;
      return set({ phase: "not_listed", message: NOT_LISTED, missing,
        detail: { ...failure(e, "price").detail, message: `Not listed on ${NETWORK.name}: ${missing.join(", ")}` } });
    }
    const bad = facts.find((f) => f.status === "rejected");
    if (bad) return set({ phase: "no_quote", message: "No price from Derive right now.", detail: failure(bad.reason, "price").detail });
    instruments = Object.fromEntries(facts.map((f) => [f.value.instrument_name, f.value]));
    if (closed) return;
    if (direction === "sell" && floor == null) {
      // No board price to sell against: the floor comes from Derive's mark for the package, so getting
      // out never depends on Cowboy's pipeline (design 2.4).
      try {
        const m = await client.call("private/rfq_get_best_quote", { subaccount_id: subaccountId, legs, direction });
        const mark = Math.abs(Number(m?.estimated_total_cost));
        if (!Number.isFinite(mark) || !(payout > 0)) throw new Error("no mark");
        floor = Math.ceil(Math.max(mark - tolerance * payout, TRADE_LIMITS.minPerDollar * payout) * 100) / 100;
      } catch (e) {
        return set({ phase: "no_quote", message: "No price from Derive right now.", detail: failure(e, "price").detail });
      }
      if (closed) return;
    }
    const params = {
      subaccount_id: subaccountId, legs, label, partial_fill_step: PARTIAL_FILL_STEP, extra_fee: EXTRA_FEE,
      ...(direction === "buy" ? { max_total_cost: String(floor) } : { min_total_cost: String(floor) }),
      ...(referral ? { referral_code: referral } : {}),
    };
    try {
      rfq = await client.call("private/send_rfq", params, { beforeSend });
    } catch (e) {
      if (closed && e.name === "AbortError") return;
      keyCheck(e);
      return set({ phase: "error", ...failure(e, "price") });
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
      keyCheck(e);
      return set({ phase: "error", ...failure(e, "price") });
    }
    if (closed || !["asking", "quoted"].includes(state.phase)) return;
    const t = now();
    const best = res?.best_quote;
    if (!best || best.status !== "open") {
      if (state.phase === "quoted") return lapse(); // the quote was pulled
      if (t - started >= QUOTE_WAIT_MS) {
        await cancel();
        return set({ phase: "no_quote", message: "No price from Derive right now.",
          detail: mode === "testnet" ? { step: "price", source: "Derive", code: "", message: `no market maker quoted within ${Math.round(QUOTE_WAIT_MS / 1000)} s`, data: "" } : null });
      }
      timer = schedule(poll, POLL_MS);
      return;
    }
    const check = quoteMatchesPlan(best, legs, direction, rfq.rfq_id)
      ? checkQuote(res, { direction, payout, limit: floor, feeEstimate })
      : { ok: false, reason: "invalid", detail: "Quote does not match the requested package" };
    // A quote worse than Derive's order book would be refused at the tap: keep waiting for a better
    // one, then ask again with a new request (makers re-price), BOOK_ASKS requests in all, before
    // saying so.
    if (!check.ok && check.reason === "book_better") {
      if (t - started < QUOTE_WAIT_MS) {
        if (state.phase === "quoted") set({ phase: "asking", quote: null, check: null, firmUntil: null });
        timer = schedule(poll, POLL_MS);
        return;
      }
      if (attempt < BOOK_ASKS) {
        stop();
        await cancel();
        if (closed) return;
        return start({ again: true });
      }
    }
    if (!check.ok) {
      await cancel();
      // Derive's own reason (free text) goes to the testnet build's (i); the screen says it plainly.
      const detail = check.reason === "invalid" ? { step: "price", source: "Derive", code: "quote_not_valid", message: check.detail || "", data: "" }
        : check.reason === "book_better" ? { step: "price", source: "Derive", code: "book_better", message: "quote total cost above Derive's order book",
          data: JSON.stringify({ quote_total_cost: check.total, orderbook_total_cost: check.book }) }
        : check.reason === "margin" ? { step: "price", source: "Cowboy", code: "margin_check", message: "initial margin used beyond price and fee",
          data: JSON.stringify({ ...check.margin, total: check.total, fee: check.fee, max_fee: check.maxFee }) } : null;
      return set({ phase: check.reason === "beyond" ? "beyond" : "blocked", check, quote: best, message: null, detail });
    }
    const fresh = best.quote_id !== state.quote?.quote_id;
    const changed = !!state.quote && (fresh || check.total !== state.check?.total || check.maxFee !== state.check?.maxFee);
    set({ phase: "quoted", quote: best, check, best: res, firmUntil: fresh ? t + FIRM_MS : state.firmUntil, changed });
    if (t >= state.firmUntil) return lapse();
    timer = schedule(poll, POLL_MS);
  }

  async function lapse() {
    stop();
    await cancel();
    set({ phase: "lapsed" });
  }

  function sign() {
    const nowS = Math.floor(now() / 1000);
    return buildExecute({
      quote: state.quote, subaccountId, owner, key, instruments, maxFee: state.best.suggested_max_fee, chainId,
      nonce: makeNonce(now()), expirySec: executeExpiry(nowS, rfq?.valid_until), referral, label,
    });
  }

  /**
   * The user's tap, carrying the quote and amounts they saw. If the quote changed since, nothing is signed
   * and the new number waits for a fresh tap. Otherwise the execution is signed with the Saloon key:
   * in a dry run it goes to public/execute_quote_debug and nothing fills; in a testnet build it goes
   * to private/execute_quote on the testnet; in a mainnet build, to private/execute_quote on mainnet
   * once the fresh switch read allows it.
   */
  async function confirm(approval) {
    if (closed) return;
    if (state.phase !== "quoted" || now() >= state.firmUntil) return lapse();
    if (!approval || approval.quoteId !== state.quote.quote_id || approval.total !== state.check.total
      || approval.maxFee !== state.check.maxFee) return set({ changed: true });
    stop();
    if (FILL_MODES.includes(mode)) return execute();
    set({ phase: "checking" });
    try {
      const built = sign();
      const remote = await client.call("public/execute_quote_debug", built.payload);
      const match = debugMatches(built.local, remote);
      set({ phase: "checked", debug: { ...match, legsTotal: packageCost(state.quote.legs) } });
    } catch (e) {
      set({ phase: "error", ...failure(e, tapStep) });
    } finally {
      await cancel();
    }
  }

  async function execute() {
    if (closed) return;
    let live = false;
    if (mode === "mainnet") {
      // Real money: the published switch is read again now, not from the page's copy, and a read
      // that fails counts as off. Then only a pilot wallet, in a direction the switch allows.
      set({ phase: "executing" });
      let s = "off";
      try { s = await readSwitch(); } catch { s = "off"; }
      const now_ = setMainnetSwitch(s);
      if (closed) return;
      if (!mainnetOpen(wallet, direction)) {
        await cancel();
        return set({ phase: "paused", message: isPilot(wallet) ? (TRADING_NOTICE[now_] || TRADING_NOTICE.off) : PILOT_ONLY });
      }
      live = true;
    }
    // The fill guard: nothing is signed or sent unless this build's mode, network, endpoint and signing
    // domain all agree (a testnet build on the testnet; a mainnet build on mainnet, switch on).
    if (!fillsAllowed(network, mode, live) || chainId !== network.chainId || domainSeparator(chainId) !== network.domainSeparator) {
      await cancel();
      return set({ phase: "error", ...failure({ code: MAINNET_GUARD, source: "Cowboy" }, tapStep) });
    }
    const blocked = gate(direction === "buy" ? state.check.mostLose : null);
    if (blocked) { await cancel(); return set(blocked); }
    set({ phase: "executing" });
    const sentAt = Math.floor(now() / 1000);
    let res;
    try {
      const built = sign();
      res = await client.call(EXECUTE, { ...built.payload, ...built.extra }, { safe: false, beforeSend });
    } catch (e) {
      if (closed && e.name === "AbortError") return;
      if (UNKNOWN_CODES.has(e?.code)) return settle(sentAt);
      await cancel();
      keyCheck(e);
      const f = failure(e, tapStep);
      if (EXPIRED_CODES.has(e?.code)) return set({ phase: "expired", message: OUTCOME.expired, detail: f.detail });
      if (BUSY_CODES.has(e?.code)) return set({ phase: "busy", message: OUTCOME.busy, detail: f.detail });
      return set({ phase: "rejected", ...f });
    }
    return outcome(res, sentAt);
  }

  /** What execute_quote answered: filled (all or part), or not, with Derive's reason. */
  async function outcome(res, sentAt) {
    const pct = Number(res?.rfq_filled_pct ?? res?.fill_pct);
    if (res?.status === "filled" || pct > 0) return record(res, sentAt, Number.isFinite(pct) ? pct : 1);
    await cancel();
    if (res?.status === "cancelled") {
      keyCheck(res.cancel_reason);
      return set({ phase: "rejected", message: CANCEL_PLAIN[res.cancel_reason] || plainError(null),
        detail: { ...errorDetail(res.cancel_reason || "cancelled", tapStep), message: "execute_quote answered cancelled" } });
    }
    if (res?.status === "expired") return set({ phase: "expired", message: OUTCOME.expired });
    return settle(sentAt);
  }

  /**
   * Read the fill from Derive's trade history, retrying while it catches up, until every planned leg
   * is there with its share; else take execute_quote's own legs when they are complete. A fill still
   * short of a leg is recorded flagged `complete: false` (Positions repairs it from Derive's trades on
   * the next sync), never as the package.
   */
  async function record(res, sentAt, pct) {
    filled = pct >= 1 - 1e-9;
    set({ phase: "confirming" });
    const rfqId = rfq?.rfq_id || res?.rfq_id;
    let fill = null;
    let partRead = null;
    for (let i = 0; i < CHECK_TRIES && !fill; i += 1) {
      try {
        const rows = await tradesOf(client, subaccountId, { rfqId, quoteId: res?.quote_id, sinceSec: sentAt });
        const f = fillFromTrades(rows, { rfqId, planned });
        if (f && fillComplete(f, planned, pct)) fill = f;
        else if (f) partRead = f;
      } catch { /* read again */ }
      if (!fill && i < CHECK_TRIES - 1) await sleep(CHECK_MS);
    }
    if (!fill && res?.legs) {
      const f = fillFromExecute(res, userSide(legs, direction), { planned });
      if (f && fillComplete(f, planned, pct)) fill = f;
      else if (f && !partRead) partRead = f;
    }
    if (fill) fill = { ...fill, complete: true };
    else if (partRead) fill = { ...partRead, complete: false };
    if (!fill) return set({ phase: "unknown", message: OUTCOME.unknown, rfqId });
    if (!filled) await cancel(); // a part fill: the rest is cancelled, never retried
    filled = true;
    const done = { ...fill, direction, pct: Math.min(1, pct), partial: pct < 1 - 1e-9, label, network: network.name,
      quote_total: state.check?.total ?? null };
    if (direction === "buy") addSpent(wallet, done.premium + (done.fees || 0), now());
    try { onFill(done); } catch { /* recording must not hide the fill */ }
    set({ phase: "filled", fill: done });
  }

  /** No clear answer to the tap: re-read the RFQ until Derive says filled, cancelled or expired. */
  async function settle(sentAt) {
    set({ phase: "confirming" });
    const rfqId = rfq?.rfq_id;
    for (let i = 0; i < CHECK_TRIES; i += 1) {
      try {
        const r = await client.call("private/get_rfqs", { subaccount_id: subaccountId, rfq_id: rfqId });
        const row = (r?.rfqs || []).find((x) => x.rfq_id === rfqId);
        const pct = Number(row?.filled_pct);
        if (row && pct > 0) return record({ rfq_id: rfqId }, sentAt, pct);
        if (row && (row.status === "cancelled" || row.status === "expired")) {
          rfq && (rfq.cancelled = true);
          return set({ phase: "not_filled", message: OUTCOME.not_filled });
        }
      } catch { /* read again */ }
      if (i < CHECK_TRIES - 1) await sleep(CHECK_MS);
    }
    set({ phase: "unknown", message: OUTCOME.unknown, rfqId });
  }

  /** "Check again" after an unknown answer: never re-sends, only re-reads. */
  async function recheck() {
    if (closed || state.phase !== "unknown") return;
    return settle(Math.floor(now() / 1000) - 600);
  }

  async function close() {
    closed = true;
    stop();
    await cancel();
    set({ phase: "closed" });
  }

  return { start, confirm, recheck, close, get state() { return state; }, get rfqId() { return rfq?.rfq_id || null; } };
}

/** The P5 dry run, as it was: a ticket that never fills. */
export const createDryRun = (opts) => createTicket({ ...opts, mode: "dryrun" });
