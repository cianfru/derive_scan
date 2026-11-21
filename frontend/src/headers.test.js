// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("permits the shipped theme bootstrap and the configured Derive endpoints", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const headers = Object.fromEntries(config.headers.find((entry) => entry.source === "/(.*)").headers.map((h) => [h.key, h.value]));
  const policy = headers["Content-Security-Policy"];
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const theme = html.match(/<script>(.*?)<\/script>/s)[1];
  expect(policy).toContain(`'sha256-${createHash("sha256").update(theme).digest("base64")}'`);
  expect(policy).toContain("wss://api.derive.xyz");
  expect(policy).toContain("wss://testnet.api.derive.xyz");
  const connect = policy.match(/connect-src[^;]+/)[0];
  for (const origin of ["https://li.quest", "https://ethereum-rpc.publicnode.com", "https://base-rpc.publicnode.com", "https://arbitrum-one-rpc.publicnode.com", "https://rpc.hyperliquid.xyz"]) expect(connect).toContain(origin);
  // Rysk (Receive premium, VITE_RYSK builds): its taker socket, gas-fee endpoint and HyperEVM's RPCs.
  for (const origin of ["wss://v12.rysk.finance", "https://v12.rysk.finance", "wss://rip-testnet.rysk.finance", "https://rip-testnet.rysk.finance", "https://rpc.hyperliquid-testnet.xyz"]) expect(connect).toContain(origin);
  expect(connect).not.toContain("*");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy.match(/script-src[^;]+/)[0]).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
});
