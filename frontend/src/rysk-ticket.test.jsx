// Receive premium on screen: the ticket reads Rysk's listing, shows the obligation first, gets a firm
// premium, and locks and receives it with one approval and one signature, timing each step. Rysk is a
// fake socket answering with replies saved on 10 October 2026; the wallet is a throwaway fake.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import assets from "./fixtures/rysk/assets.json";
import inventory from "./fixtures/rysk/inventory.json";
import caps from "./fixtures/rysk/caps.json";
import RyskTicket from "./components/rysk/RyskTicket.jsx";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { BANNED } from "./lib/questions.js";
import { loadRyskTrades } from "./lib/rysk/records.js";

const BASE = {
  name: "testnet", real: false, chainId: 999, chainName: "HyperEVM", apiUrl: "https://rysk.test", rpc: "https://rpc.test/evm", explorer: "https://explorer.test", appUrl: "https://rysk.test/",
  metamask: { chainId: "0x3e7", chainName: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: ["https://rpc.test/evm"], blockExplorerUrls: ["https://explorer.test"] },
  rysk: "0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35", marginPool: "0x24a44f1dc25540c62c1196FfC297dFC951C91aB4", usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f",
};

function fakeRysk() {
  const listeners = new Map(), sent = [];
  const push = (id, frame) => (listeners.get(id) || []).forEach((fn) => fn(frame));
  return {
    sent,
    on(id, fn) { if (!listeners.has(id)) listeners.set(id, []); listeners.get(id).push(fn); return () => {}; },
    async send(method, params) {
      sent.push({ method, params });
      if (method === "request") setTimeout(() => push("request", { id: "request", result: {
        assetAddress: params.asset, chainId: params.chainId, expiry: params.expiry, isPut: params.isPut, isTakerBuy: false,
        maker: "0x1111111111111111111111111111111111111111", nonce: "7", price: (25n * 10n ** 18n).toString(), quantity: params.quantity,
        strike: params.strike, validUntil: Math.floor(Date.now() / 1000) + 40, usd: params.usd, collateralAsset: params.collateralAsset,
        signature: `0x${"ab".repeat(65)}`, apy: 9.3,
      } }), 10);
    },
    async call(method, params) {
      sent.push({ method, params });
      if (method === "assets") return assets;
      if (method === "inventory") return inventory;
      if (method === "caps") return caps;
      if (method === "positions") return [];
      if (method === "confirm") return `0x${"cd".repeat(32)}`;
      throw new Error(method);
    },
    close() {},
  };
}

const fetchImpl = vi.fn(async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.endsWith("/api/gas")) return { ok: true, json: async () => ({ ...body, gasFee: "40000" }) };
  const result = body.method === "eth_getBalance" ? `0x${(10n ** 18n).toString(16)}` : `0x${(10n ** 24n).toString(16)}`;
  return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
});

afterEach(() => { cleanup(); localStorage.clear(); });

describe("Receive premium on Rysk", () => {
  it("shows the obligation, a firm premium, and fills with timed steps", async () => {
    const rysk = fakeRysk();
    const wallet = fakeWallet({ chainId: 1, usdc: 10n ** 30n });
    const user = userEvent.setup();
    render(<RyskTicket und="ETH" settleTs={undefined} near={2600} side="yes" net={BASE} socketFactory={() => rysk} provider={wallet} fetchImpl={fetchImpl} />);
    await screen.findByText(/You lock until/);
    expect(screen.getByText("0.5 UETH")).toBeTruthy();
    expect(screen.getByText("You sell 0.5 ETH")).toBeTruthy();
    expect(screen.getByText("You keep 0.5 ETH")).toBeTruthy();
    expect(await screen.findByText("$12.50", {}, { timeout: 3000 })).toBeTruthy();
    const req = rysk.sent.find((m) => m.method === "request").params;
    expect(req.taker).toBe("0x0000000000000000000000000000000000000000");
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    const go = await screen.findByRole("button", { name: /^Lock 0\.5 UETH and receive \$12\.50$/ }, { timeout: 4000 });
    await waitFor(() => expect(go.disabled).toBe(false), { timeout: 4000 });
    await user.click(go);
    await screen.findByText(/Done in/, {}, { timeout: 5000 });
    expect(screen.getByText("$12.46")).toBeTruthy();
    expect(rysk.sent.filter((m) => m.method === "confirm")).toHaveLength(1);
    const [rec] = loadRyskTrades("testnet");
    expect(rec.outcome).toBe("filled");
    expect(Object.keys(rec.timings)).toContain("settle");
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("locks USDC when buying at a level", async () => {
    render(<RyskTicket und="ETH" near={2300} side="no" net={BASE} socketFactory={() => fakeRysk()} provider={null} fetchImpl={fetchImpl} />);
    await screen.findByText(/You lock until/);
    expect(screen.getByText(/USDC$/, { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("You buy 0.5 ETH")).toBeTruthy();
  });

  it("keeps real money to pilot wallets", async () => {
    const user = userEvent.setup();
    render(<RyskTicket und="ETH" near={2600} side="yes" net={{ ...BASE, name: "mainnet", real: true }} socketFactory={() => fakeRysk()} provider={fakeWallet({ chainId: 999 })} fetchImpl={fetchImpl} />);
    expect(await screen.findByText(/Real money/)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByText("Trading on Rysk is open to pilot wallets first.")).toBeTruthy();
    const go = await screen.findByRole("button", { name: /^Lock|Waiting/ });
    expect(go.disabled).toBe(true);
  });

  it("offers to wrap HYPE when selling HYPE and the wallet holds HYPE but no WHYPE", async () => {
    const user = userEvent.setup();
    const rpc = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const result = body.method === "eth_getBalance" ? `0x${(100n * 10n ** 18n).toString(16)}` : "0x0"; // 100 HYPE, no WHYPE, no USDC
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
    });
    render(<RyskTicket und="HYPE" near={95} side="yes" net={BASE} socketFactory={() => fakeRysk()} provider={fakeWallet({ chainId: 999 })} fetchImpl={rpc} />);
    await screen.findByText(/You lock until/);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByRole("button", { name: /^Wrap 25 HYPE to WHYPE$/ })).toBeTruthy();
  });

  it("says so when Rysk lists nothing for the coin", async () => {
    render(<RyskTicket und="DOGE" net={BASE} socketFactory={() => fakeRysk()} provider={null} fetchImpl={fetchImpl} />);
    expect(await screen.findByText("Rysk lists no DOGE options on HyperEVM now.")).toBeTruthy();
  });
});
