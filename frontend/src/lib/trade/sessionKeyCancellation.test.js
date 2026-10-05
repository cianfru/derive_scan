import { _resetTradeStorage } from "./store.js";
import { beforeEach, describe, expect, it } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import { fakeWallet } from "./fakeWallet.js";
import { approveCowboy, loadKey, switchOff } from "./sessionKey.js";
import { keyFromSecret } from "./sign.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const newKey = (phrase) => () => keyFromSecret(keccak256(toUtf8Bytes(phrase)));
const options = (wallet, client, phrase = "old cancellation key") => ({
  client, provider: wallet, owner: wallet.address, subaccountId: 101, newKey: newKey(phrase),
});
beforeEach(() => { localStorage.clear(); _resetTradeStorage(); });

describe("browser key writes belong to their approval", () => {
  it("does not store a late accepted grant after its operation is cancelled", async () => {
    const wallet = fakeWallet(), accepted = deferred(), response = deferred();
    let active = true;
    const approval = approveCowboy({ ...options(wallet, { call: (method, p) => { accepted.resolve(p); return response.promise; } }),
      assertActive: () => { if (!active) throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
    });
    const grant = await accepted.promise;
    active = false;
    response.resolve(grant);
    await expect(approval).rejects.toMatchObject({ name: "AbortError" });
    expect(loadKey(wallet.address)).toBeNull();
  });

  it("a delayed retirement cannot clear a different key approved meanwhile", async () => {
    const wallet = fakeWallet();
    const client = { call: async (method, params) => params };
    const oldKey = await approveCowboy(options(wallet, client));
    const retiring = deferred(), response = deferred();
    const off = switchOff({ client: { call: (method, p) => { retiring.resolve(p); return response.promise; } },
      provider: wallet, owner: wallet.address, stored: oldKey });
    const near = await retiring.promise;
    const replacement = await approveCowboy(options(wallet, client, "replacement cancellation key"));
    response.resolve(near);
    await off;
    expect(loadKey(wallet.address)).toEqual(replacement);
  });
});
