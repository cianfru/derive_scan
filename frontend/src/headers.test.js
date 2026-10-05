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
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy.match(/script-src[^;]+/)[0]).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
});
