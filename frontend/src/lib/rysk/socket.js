// Rysk's taker socket: JSON-RPC 2.0 frames whose id is the method name, so a reply and any later push
// for that method arrive under the same id (that is how firm quotes keep coming for one request).
// Opened by the Receive premium ticket while it is on screen; nothing here signs or holds a key.
import { RYSK } from "./config.js";

export function ryskSocket({ url = RYSK?.wsUrl, WebSocketImpl = globalThis.WebSocket, openMs = 10_000 } = {}) {
  const listeners = new Map();
  let ws = null, opening = null, closed = false;

  const emit = (id, frame) => { for (const fn of [...(listeners.get(id) || [])]) fn(frame); };
  function open() {
    if (closed) return Promise.reject(Object.assign(new Error("closed"), { code: "rysk_closed" }));
    if (ws?.readyState === 1) return Promise.resolve();
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!url || !WebSocketImpl) return reject(Object.assign(new Error("Rysk is not reachable from this build."), { code: "rysk_off" }));
      const sock = new WebSocketImpl(url);
      ws = sock;
      const timer = setTimeout(() => { reject(Object.assign(new Error("Rysk did not answer."), { code: "rysk_timeout" })); try { sock.close(); } catch { /* gone */ } }, openMs);
      sock.onopen = () => { clearTimeout(timer); resolve(); };
      sock.onerror = () => { clearTimeout(timer); reject(Object.assign(new Error("Rysk's connection failed."), { code: "rysk_connection" })); };
      sock.onclose = () => { clearTimeout(timer); if (ws === sock) ws = null; opening = null; emit("__close", {}); };
      sock.onmessage = (e) => {
        let frame;
        try { frame = JSON.parse(e.data); } catch { return; }
        if (frame && typeof frame.id === "string") emit(frame.id, frame);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  /** Listen to every frame for a method (replies and pushes). Returns the unsubscribe. */
  function on(id, fn) {
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(fn);
    return () => listeners.get(id)?.delete(fn);
  }

  async function send(method, params) {
    await open();
    const frame = { jsonrpc: "2.0", method, id: method };
    if (params !== undefined) frame.params = params;
    ws.send(JSON.stringify(frame));
  }

  /** One request and its next reply: the result, or an Error carrying Rysk's message. */
  function call(method, params, { timeout = 15_000 } = {}) {
    return new Promise((resolve, reject) => {
      let off = () => {}, offClose = () => {};
      const done = (fn, v) => { clearTimeout(timer); off(); offClose(); fn(v); };
      const timer = setTimeout(() => done(reject, Object.assign(new Error("Rysk did not answer in time."), { code: "rysk_timeout", method })), timeout);
      off = on(method, (f) => (f.error
        ? done(reject, Object.assign(new Error(f.error.message || "Rysk refused the request."), { code: f.error.code ?? "rysk_error", source: "Rysk", method }))
        : done(resolve, f.result)));
      offClose = on("__close", () => done(reject, Object.assign(new Error("Rysk's connection closed."), { code: "rysk_closed", method })));
      send(method, params).catch((e) => done(reject, e));
    });
  }

  function close() {
    closed = true;
    listeners.clear();
    try { ws?.close(); } catch { /* gone */ }
    ws = null;
  }

  return { open, on, send, call, close, get isOpen() { return ws?.readyState === 1; } };
}
