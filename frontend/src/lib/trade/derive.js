// Saloon stage 2, P2: Derive's JSON-RPC over the browser's own WebSocket (Derive docs "Connecting
// over WebSocket"). One connection per page; calls correlate by id. Reads that Derive marks as safe to
// repeat (9002 backend unavailable, -32000 rate limit) are retried with a growing pause; a dropped
// socket reconnects on the next call and logs in again. Nothing here holds or sends a wallet key.
import { NETWORK } from "./config.js";

export class DeriveError extends Error {
  constructor(code, message, data) {
    super(message || `Derive error ${code}`);
    this.name = "DeriveError";
    this.code = code;
    this.data = data;
  }
}

/** Codes Derive documents as "nothing was executed; retry". */
export const RETRYABLE = new Set([9002, -32000]);
export const SOCKET_CLOSED = "socket_closed";
export const TIMEOUT = "timeout";

/** Plain messages for what can go wrong (design 2.4). No codes on screen. */
const PLAIN = {
  11104: "That price is no longer open. Asking again.",
  11110: "Derive's screen has a better price. Asking again.",
  11112: "Derive takes fewer legs in one package.",
  11111: "Derive has this kind of trade switched off for your account.",
  11107: "Derive's price is far from its mark right now.",
  11000: "Not enough USDC in your Saloon account.",
  11021: "No price from Derive right now.",
  12001: "No price from Derive right now.",
  9002: "Derive isn't taking orders right now.",
  9000: "Checking with Derive.",
  9001: "Checking with Derive.",
  "-32000": "Derive is busy. Trying again in a moment.",
  "-32100": "Too many Derive tabs are open. Close one and try again.",
  14000: "Derive has no account for this wallet yet.",
  14001: "Derive has no Saloon account for this wallet yet.",
  16001: "Derive did not accept this trade.",
  16002: "Derive did not accept this trade.",
  401: "Connect again to continue.",
  403: "Derive is not available here.",
  4001: "You declined in your wallet.",
  [SOCKET_CLOSED]: "Derive isn't taking orders right now.",
  [TIMEOUT]: "Derive isn't taking orders right now.",
};
export const CANCEL_PLAIN = {
  compliance: "Derive did not accept this trade.",
  insufficient_margin: "Not enough USDC in your Saloon account.",
  signed_max_fee_too_low: "Derive's fee is higher than usual right now.",
  rfq_no_longer_open: "That price is no longer open. Asking again.",
  session_key_deregistered: "Cowboy's approval has ended. Approve again to continue.",
  validation_failed: "Derive did not accept this package.",
};
export const FALLBACK_PLAIN = "Derive didn't accept that. Try again.";

export function plainError(err) {
  if (!err) return FALLBACK_PLAIN;
  if (typeof err === "string") return CANCEL_PLAIN[err] || PLAIN[err] || FALLBACK_PLAIN;
  const code = err.code ?? err?.error?.code;
  return PLAIN[String(code)] || PLAIN[code] || FALLBACK_PLAIN;
}

/** Derive is "down" for the Saloon when any live incident is medium or high. */
export function incidentState(result) {
  const list = result?.incidents || [];
  if (list.some((i) => i.severity === "medium" || i.severity === "high")) return "down";
  return list.length ? "notice" : "ok";
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The client. `WebSocketImpl` defaults to the browser's WebSocket; tests pass a fake that replays
 * recorded frames. `retries` applies only to calls marked safe to repeat.
 */
export function createClient({
  url = NETWORK.wsUrl, WebSocketImpl = globalThis.WebSocket, timeoutMs = 10_000, retries = 3, backoffMs = 400,
  sleep = wait, onStatus = () => {},
} = {}) {
  if (!url) throw new Error("no Derive endpoint for this network");
  let ws = null;
  let opening = null;
  let nextId = 1;
  let login = null; // { wallet, sign } to repeat after a reconnect
  const pending = new Map();
  let status = "idle";
  const setStatus = (s) => { status = s; onStatus(s); };

  const failAll = (code) => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new DeriveError(code, PLAIN[code])); }
    pending.clear();
  };

  function open() {
    if (ws && ws.readyState === 1) return Promise.resolve();
    if (opening) return opening;
    setStatus("connecting");
    opening = new Promise((resolve, reject) => {
      const sock = new WebSocketImpl(url);
      ws = sock;
      sock.onopen = () => { opening = null; setStatus("open"); resolve(); };
      sock.onerror = () => { /* onclose follows */ };
      sock.onclose = () => {
        if (ws === sock) ws = null;
        const wasOpening = !!opening;
        opening = null;
        setStatus("closed");
        failAll(SOCKET_CLOSED);
        if (wasOpening) reject(new DeriveError(SOCKET_CLOSED, PLAIN[SOCKET_CLOSED]));
      };
      sock.onmessage = (ev) => {
        if (typeof ev.data !== "string" || ev.data === "pong") return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const p = pending.get(msg.id);
        if (!p) return; // subscription notifications are not used in the dry run
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new DeriveError(msg.error.code, msg.error.message, msg.error.data));
        else p.resolve(msg.result);
      };
    });
    return opening;
  }

  function sendOnce(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new DeriveError(TIMEOUT, PLAIN[TIMEOUT])); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }));
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        reject(new DeriveError(SOCKET_CLOSED, PLAIN[SOCKET_CLOSED]));
      }
    });
  }

  let relogin = null;
  async function ensure() {
    const fresh = !(ws && ws.readyState === 1);
    await open();
    if (fresh && login) {
      relogin = relogin || doLogin(login).finally(() => { relogin = null; });
      await relogin;
    }
  }

  async function doLogin({ wallet, sign }) {
    const timestamp = String(Date.now());
    const signature = await sign(timestamp);
    return sendOnce("public/login", { wallet, timestamp, signature });
  }

  /** One call. `safe` (default true) allows Derive's retryable errors to be retried. */
  async function call(method, params, { safe = true } = {}) {
    let attempt = 0;
    for (;;) {
      try {
        await ensure();
        return await sendOnce(method, params);
      } catch (e) {
        const retryable = safe && (RETRYABLE.has(e.code) || (e.code === SOCKET_CLOSED && attempt === 0));
        if (!retryable || attempt >= retries) throw e;
        attempt += 1;
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  return {
    call,
    get status() { return status; },
    /** Logs this connection in for `wallet`; `sign(timestamp)` signs the EIP-191 message (the wallet or the session key). */
    async login(wallet, sign) {
      login = { wallet, sign };
      await open();
      return doLogin(login);
    },
    logout() { login = null; },
    close() {
      login = null;
      const s = ws;
      ws = null;
      failAll(SOCKET_CLOSED);
      if (s) try { s.close(); } catch { /* already closed */ }
      setStatus("closed");
    },
  };
}

/** Is Derive taking orders? Reads public/get_live_incidents once per ticket. */
export async function checkIncidents(client) {
  try {
    return incidentState(await client.call("public/get_live_incidents", {}));
  } catch {
    return "down";
  }
}

/** Static instrument facts the signed execution needs (asset address, sub id, amount step); cached per page. */
export function instrumentCache(client) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      const p = client.call("public/get_instrument", { instrument_name: name });
      p.catch(() => cache.delete(name));
      cache.set(name, p);
    }
    return cache.get(name);
  };
}
