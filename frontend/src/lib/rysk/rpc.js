// Read-only HyperEVM reads for the ticket's balance line, through the chain's public RPC (the wallet may
// be on another chain while the user looks). Never sends a transaction.
import { Interface } from "ethers";

const erc20 = /* @__PURE__ */ new Interface(["function balanceOf(address) view returns (uint256)"]);

async function rpc(url, method, params, fetchImpl) {
  const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new Error(`HyperEVM read failed (${r.status})`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "HyperEVM read failed");
  return j.result;
}

/** The wallet's HYPE (for gas) and its balance of each token, in base units; a failed read is null. */
export async function hyperBalances(url, wallet, tokens, fetchImpl = globalThis.fetch) {
  const one = (p) => p.then((v) => BigInt(v)).catch(() => null);
  const [hype, ...held] = await Promise.all([
    one(rpc(url, "eth_getBalance", [wallet, "latest"], fetchImpl)),
    ...tokens.map((t) => one(rpc(url, "eth_call", [{ to: t, data: erc20.encodeFunctionData("balanceOf", [wallet]) }, "latest"], fetchImpl))),
  ]);
  return { hype, tokens: Object.fromEntries(tokens.map((t, i) => [t.toLowerCase(), held[i]])) };
}
