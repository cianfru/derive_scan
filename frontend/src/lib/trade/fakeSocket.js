// A stand-in for Derive's WebSocket, for tests and local previews only. It answers JSON-RPC frames
// from handlers (method -> function or value) and falls back to frames recorded from V3 testnet's
// public methods (src/fixtures/trade/public_frames.json). It never opens a network connection.

export function fakeDerive({ handlers = {}, recorded = [] } = {}) {
  const log = [];
  const sockets = [];
  const byKey = new Map();
  for (const r of recorded) byKey.set(`${r.method}|${r.params?.instrument_name || ""}`, r.frame);

  async function answer(msg) {
    const h = handlers[msg.method];
    if (h !== undefined) {
      try {
        const out = typeof h === "function" ? await h(msg.params || {}, { log }) : h;
        if (out && out.__error) return { jsonrpc: "2.0", id: msg.id, error: out.__error };
        return { jsonrpc: "2.0", id: msg.id, result: out };
      } catch (e) {
        return { jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -1, message: e.message || "error" } };
      }
    }
    const frame = byKey.get(`${msg.method}|${msg.params?.instrument_name || ""}`) || byKey.get(`${msg.method}|`);
    if (frame) return { ...frame, id: msg.id };
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
      Promise.resolve().then(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } });
    }
    send(text) {
      if (this.readyState !== 1) throw new Error("not open");
      const msg = JSON.parse(text);
      log.push(msg);
      answer(msg).then((frame) => { if (this.readyState === 1 && frame !== null) this.onmessage?.({ data: JSON.stringify(frame) }); });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({});
    }
    /** The server side going away. */
    drop() { this.close(); }
  }
  return { WebSocketImpl: FakeSocket, log, sockets, calls: (m) => log.filter((x) => x.method === m) };
}

/** A Derive error a handler can return. */
export const deriveError = (code, message = "error") => ({ __error: { code, message } });
