// @vitest-environment node
// Bundle check: a build with VITE_SALOON_TRADE off carries no trading code, and a build with it on
// carries it only in its own lazy chunk and points nowhere but Derive's testnet. A "testnet" build
// (P6 fills) adds the header badge and the header's wallet (its code in the same lazy chunk) and
// nothing that reaches a mainnet endpoint.
import { it, expect } from "vitest";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
/** The header's wallet: its words and class names, which only a testnet build may carry. */
const WALLET = /Connect wallet|Switch off Cowboy|Derive testnet · test USDC|hw-btn|hdr-wallet/;
const MARKERS = [/0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D/i, /testnet\.api\.derive\.xyz/, /EIP712Domain/, /set_session_key/, /private\/execute_quote/, /get_trade_history/];

async function bundle(env, exts = [".js"]) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const out = mkdtempSync(join(tmpdir(), "cowboy-bundle-"));
  try {
    await build({ root: ROOT, configFile: false, plugins: [react()], logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const dir = join(out, "assets");
    return readdirSync(dir).filter((f) => exts.some((x) => f.endsWith(x))).map((f) => ({ f, src: readFileSync(join(dir, f), "utf8") }));
  } finally {
    for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
    rmSync(out, { recursive: true, force: true });
  }
}

it("leaves trading code out of a build with the flag off, even with the Saloon on", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "" }, [".js", ".css"]);
  for (const { f, src } of files) {
    for (const m of MARKERS) expect(m.test(src), `${f} ${m}`).toBe(false);
    expect(src, f).not.toMatch(/testnet build|One tap works|Bought in one tap|Testnet</);
    expect(src, f).not.toMatch(WALLET);
    expect(src, f).not.toMatch(/Details for testing/);
  }
}, 120_000);

it("leaves trading code and the testnet badge out of a build with the Saloon off", async () => {
  const files = await bundle({ VITE_QUESTIONS: "", VITE_SALOON_TRADE: "testnet" }, [".js", ".css"]);
  for (const { f, src } of files) {
    for (const m of MARKERS) expect(m.test(src), `${f} ${m}`).toBe(false);
    expect(src, f).not.toMatch(/testnet build/);
    expect(src, f).not.toMatch(WALLET);
  }
}, 120_000);

it("builds a testnet app: fills on the testnet only, in the trade chunk, with the header badge", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "testnet" });
  const withTrade = files.filter(({ src }) => MARKERS[0].test(src)).map(({ f }) => f);
  expect(withTrade).toHaveLength(1);
  expect(withTrade[0]).toMatch(/^TradePanel-/);
  expect(files.find(({ f }) => f.startsWith("TradePanel-")).src).toMatch(/private\/execute_quote/);
  expect(files.some(({ src }) => /Cowboy home, testnet build/.test(src))).toBe(true);
  // The header's wallet: a placeholder and its styles in the entry, no trading code there; the menu
  // itself (connect, Switch off Cowboy, Disconnect) only in the trade chunk.
  const entry = files.find(({ f }) => f.startsWith("index-"));
  expect(entry.src).toMatch(/Connect wallet/);
  expect(entry.src).toMatch(/\.hw-btn/);
  for (const m of MARKERS) expect(m.test(entry.src), `entry ${m}`).toBe(false);
  expect(entry.src).not.toMatch(/Switch off Cowboy/);
  // Error details for testing: in the trade chunk of this build only.
  expect(files.filter(({ src }) => /Details for testing/.test(src)).map(({ f }) => f)).toEqual(withTrade);
  const menu = files.filter(({ src }) => /Switch off Cowboy/.test(src)).map(({ f }) => f);
  expect(menu).toEqual(withTrade);
  for (const { src } of files) {
    expect(src).not.toMatch(/wss:\/\/api\.derive\.xyz/);
    expect(src).not.toMatch(/https:\/\/api\.derive\.xyz/);
  }
}, 120_000);

it("keeps trading code in its own chunk, on testnet only, with the flag on", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "1" });
  const withTrade = files.filter(({ src }) => MARKERS[0].test(src)).map(({ f }) => f);
  expect(withTrade).toHaveLength(1);
  expect(withTrade[0]).toMatch(/^TradePanel-/);
  // The dry run has no wallet in the header: the entry carries none of it.
  expect(files.find(({ f }) => f.startsWith("index-")).src).not.toMatch(WALLET);
  // Nor the testnet build's error details.
  for (const { f, src } of files) expect(src, f).not.toMatch(/Details for testing/);
  for (const { src } of files) {
    expect(src).not.toMatch(/wss:\/\/api\.derive\.xyz/);
    expect(src).not.toMatch(/https:\/\/api\.derive\.xyz/);
  }
}, 120_000);
