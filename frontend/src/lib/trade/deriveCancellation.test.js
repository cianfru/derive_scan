import { describe, expect, it } from "vitest";
import { createClient, EXECUTE, SOCKET_CLOSED } from "./derive.js";
import { TESTNET_WS } from "./config.js";
import { deriveError, fakeDerive } from "./fakeSocket.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const client = (fake, opts = {}) => createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {}, ...opts });

describe("explicit closure is terminal, unlike a server-side drop", () => {
  it("rejects an opening socket and refuses later calls without opening another socket", async () => {
    const fake = fakeDerive({ handlers: { "public/get_time": 42 } });
    const c = client(fake);
    const reading = c.call("public/get_time");
    c.close();
    await expect(reading).rejects.toMatchObject({ code: SOCKET_CLOSED });
    await expect(c.call("public/get_time")).rejects.toMatchObject({ code: SOCKET_CLOSED });
    expect(fake.sockets).toHaveLength(1);
    expect(fake.log).toHaveLength(0);
    expect(c.status).toBe("closed");
  });

  it("does not retry a read when closed while waiting for backoff", async () => {
    const sleeping = deferred(), release = deferred();
    const fake = fakeDerive({ handlers: { "public/get_time": deriveError(9002) } });
    const c = client(fake, { sleep: () => { sleeping.resolve(); return release.promise; } });
    const reading = c.call("public/get_time");
    await sleeping.promise;
    c.close(); release.resolve();
    await expect(reading).rejects.toMatchObject({ code: SOCKET_CLOSED });
    expect(fake.calls("public/get_time")).toHaveLength(1);
    expect(fake.sockets).toHaveLength(1);
  });

  for (const method of ["close", "logout"]) it(`does not send a deferred sign-in after ${method}`, async () => {
    const signing = deferred(), signature = deferred();
    const fake = fakeDerive({ handlers: { "public/login": [101], "public/get_time": 42 } });
    const c = client(fake);
    const login = c.login("0xabc", () => { signing.resolve(); return signature.promise; });
    await signing.promise;
    c[method](); signature.resolve("fake signature");
    await expect(login).rejects.toMatchObject({ code: SOCKET_CLOSED });
    expect(fake.calls("public/login")).toHaveLength(0);
    if (method === "logout") {
      expect(await c.call("public/get_time")).toBe(42); // logout does not destroy public access
      c.close();
    }
  });

  it("reconnects naturally dropped sockets using the saved signer, independent of an old operation guard", async () => {
    const fake = fakeDerive({ handlers: { "public/login": [101], "public/get_time": 42 } });
    const c = client(fake);
    let active = true, signatures = 0;
    await c.login("0xabc", async () => { signatures += 1; return "fake signature"; }, {
      assertActive: () => { if (!active) throw new Error("old operation"); },
    });
    active = false;
    fake.sockets[0].drop();
    expect(await c.call("public/get_time")).toBe(42);
    expect(signatures).toBe(2);
    expect(fake.sockets).toHaveLength(2);
    c.close();
  });
});

describe("the execution send boundary", () => {
  it("checks beforeSend after a deferred reconnect sign-in, before putting execution on the wire", async () => {
    const signing = deferred(), signature = deferred();
    const fake = fakeDerive({ handlers: { "public/login": [101], [EXECUTE]: { rfq_id: "never sent" } } });
    const c = client(fake, { url: TESTNET_WS });
    let signs = 0, ticketClosed = false;
    await c.login("0xabc", () => {
      if (++signs === 1) return Promise.resolve("initial signature");
      signing.resolve(); return signature.promise;
    });
    fake.sockets[0].drop();
    const execution = c.call(EXECUTE, {}, { safe: false, beforeSend: () => {
      if (ticketClosed) throw new Error("ticket closed before send");
    } });
    await signing.promise;
    ticketClosed = true; signature.resolve("reconnect signature");
    await expect(execution).rejects.toThrow("ticket closed before send");
    expect(fake.calls(EXECUTE)).toHaveLength(0);
    c.close();
  });

  it("returns a dispatched execution's success when only the ticket is closed after send", async () => {
    const sent = deferred(), response = deferred();
    const fake = fakeDerive({ handlers: { [EXECUTE]: () => { sent.resolve(); return response.promise; } } });
    const c = client(fake, { url: TESTNET_WS });
    let ticketClosed = false;
    const execution = c.call(EXECUTE, {}, { safe: false, beforeSend: () => {
      if (ticketClosed) throw new Error("ticket closed before send");
    } });
    await sent.promise;
    ticketClosed = true;
    response.resolve({ rfq_id: "accepted fill" });
    await expect(execution).resolves.toEqual({ rfq_id: "accepted fill" });
    expect(fake.calls(EXECUTE)).toHaveLength(1);
    c.close();
  });
});
