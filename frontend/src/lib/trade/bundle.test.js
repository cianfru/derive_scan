// @vitest-environment node
// Bundle check: a build with VITE_SALOON_TRADE off carries no trading code, and a build with it on
// carries it only in its own lazy chunk and points nowhere but Derive's testnet. A "testnet" build
// (P6 fills) adds the header badge and the header's wallet (its code in the same lazy chunk) and
// nothing that reaches a mainnet endpoint. A "mainnet" build (P8, real money) reaches mainnet only and
// carries none of the testnet's endpoint, chain or wording.
import { it, expect } from "vitest";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
/** The header's wallet: its words and class names, which only a testnet build may carry. */
const WALLET = /Connect wallet|Switch off Cowboy|Derive testnet · test USDC|hw-btn|hdr-wallet|hdr-testnet/;
const MARKERS = [/0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D/i, /testnet\.api\.derive\.xyz/, /EIP712Domain/, /set_session_key/, /private\/execute_quote/, /get_trade_history/];

/** The live price module (lib/livePrice.js): Derive's public index feed and nothing that trades. Its endpoint is the
 * only one a file outside the trade chunk may name (owner, 7 October 2026: live prices on every page). */
const liveOnly = (src) => /spot_feed\./.test(src) && !MARKERS.some((m) => m !== MARKERS[1] && m.test(src)) && !/private\//.test(src);
const endpointOk = (m, src) => m === MARKERS[1] && liveOnly(src);

async function bundle(overrides, exts = [".js"]) {
  const env = { VITE_FUND_ANYCHAIN: "", VITE_RYSK_MOCK: "", ...overrides };
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

const FUNDING_MARKER = /li\.quest\/v1|private\/register_bridge_deposit|function aggregate3\(|function getEthBalance\(/;
const RYSK_MARKER = /rysk-mock|Made-up figures · not a Rysk quote/;

it("leaves trading code out of a build with the flag off, even with the Saloon on", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "" }, [".js", ".css"]);
  for (const { f, src } of files) {
    expect(FUNDING_MARKER.test(src), f).toBe(false);
    expect(RYSK_MARKER.test(src), f).toBe(false);
    for (const m of MARKERS) expect(m.test(src), `${f} ${m}`).toBe(false);
    expect(src, f).not.toMatch(/testnet build|One tap works|Bought in one tap|Testnet<|Loading one-tap|Reload to trade in one tap/);
    expect(src, f).not.toMatch(WALLET);
    expect(src, f).not.toMatch(/Details for testing/);
  }
}, 120_000);

it("leaves trading code and the testnet badge out of a build with the Saloon off", async () => {
  const files = await bundle({ VITE_QUESTIONS: "", VITE_SALOON_TRADE: "testnet" }, [".js", ".css"]);
  for (const { f, src } of files) {
    for (const m of MARKERS) if (!endpointOk(m, src)) expect(m.test(src), `${f} ${m}`).toBe(false);
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
  // The "Testnet" marker beside the logo is styled in the entry, so it shows on every page.
  expect(files.find(({ f }) => f.startsWith("index-")).src).toMatch(/\.hdr-testnet/);
  // The header's wallet: a placeholder and its styles in the entry, no trading code there; the menu
  // itself (connect, Switch off Cowboy, Disconnect) only in the trade chunk.
  const entry = files.find(({ f }) => f.startsWith("index-"));
  expect(entry.src).toMatch(/Connect wallet/);
  expect(entry.src).toMatch(/\.hw-btn/);
  for (const m of MARKERS) if (!endpointOk(m, entry.src)) expect(m.test(entry.src), `entry ${m}`).toBe(false);
  expect(entry.src).not.toMatch(/Switch off Cowboy/);
  // Error details for testing: in the trade chunk of this build only.
  expect(files.filter(({ src }) => /Details for testing/.test(src)).map(({ f }) => f)).toEqual(withTrade);
  const menu = files.filter(({ src }) => /Switch off Cowboy/.test(src)).map(({ f }) => f);
  expect(menu).toEqual(withTrade);
  for (const { src } of files) {
    expect(src).not.toMatch(/wss:\/\/api\.derive\.xyz/);
    expect(src).not.toMatch(/https:\/\/api\.derive\.xyz/);
    expect(src).not.toMatch(/Real money/);
  }
}, 120_000);

it("builds a real-money app: mainnet only, in the trade chunk, with none of the testnet's code or wording", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "mainnet", VITE_SALOON_PILOT: "0x0000000000000000000000000000000000000001" }, [".js", ".css"]);
  const js = files.filter(({ f }) => f.endsWith(".js"));
  const withTrade = js.filter(({ src }) => MARKERS[0].test(src)).map(({ f }) => f);
  expect(withTrade).toHaveLength(1);
  expect(withTrade[0]).toMatch(/^TradePanel-/);
  const trade = js.find(({ f }) => f.startsWith("TradePanel-")).src;
  expect(trade).toMatch(/private\/execute_quote/);
  expect(trade).toContain("wss://api.derive.xyz/v3/ws");
  expect(trade).toMatch(/Real money/);
  // Outside the trade chunk, mainnet's socket appears only in the live price module.
  for (const { f, src } of js) if (/wss:\/\/api\.derive\.xyz/.test(src) && !withTrade.includes(f)) expect(liveOnly(src), f).toBe(true);
  expect(js.some(({ src }) => liveOnly(src) && src.includes("wss://api.derive.xyz/v3/ws"))).toBe(true);
  const entry = js.find(({ f }) => f.startsWith("index-"));
  for (const m of MARKERS) expect(m.test(entry.src), `entry ${m}`).toBe(false);
  for (const { f, src } of files) {
    // Exactly one network: nothing of the testnet's endpoint, chain or wording; no testing details.
    expect(src, f).not.toMatch(/testnet\.api\.derive\.xyz|testnet\.app\.derive\.xyz/);
    expect(src, f).not.toMatch(/Sepolia|sepolia/);
    expect(src, f).not.toMatch(/Details for testing/);
    expect(src, f).not.toMatch(/test USDC|Testnet · dry run|Not on testnet|testnet build|One tap works on Derive's testnet|Show test networks|Derive testnet/);
    expect(FUNDING_MARKER.test(src), f).toBe(false);
    expect(RYSK_MARKER.test(src), f).toBe(false);
  }
}, 120_000);

it("keeps optional funding only in the trade chunk and the Rysk illustration in its own lazy chunk", async () => {
  const files = await bundle({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "mainnet", VITE_SALOON_PILOT: "all", VITE_FUND_ANYCHAIN: "1", VITE_RYSK_MOCK: "1" });
  const funding = files.filter(({ src }) => /li\.quest\/v1/.test(src));
  expect(funding).toHaveLength(1);
  expect(funding[0].f).toMatch(/^TradePanel-/);
  expect(funding[0].src).toContain("private/register_bridge_deposit");
  for (const { f, src } of files) if (f !== funding[0].f) expect(FUNDING_MARKER.test(src), f).toBe(false);
  const mock = files.filter(({ src }) => /rysk-mock/.test(src));
  expect(mock).toHaveLength(1);
  expect(mock[0].f).toMatch(/^RyskMock-/);
  expect(mock[0].src).not.toMatch(/li\.quest|eth_sendTransaction|private\/execute_quote|api\.rysk|fetch\(/);
}, 120_000);

it("discards optional provider code when trading and the Saloon are disabled", async () => {
  const files = await bundle({ VITE_QUESTIONS: "", VITE_SALOON_TRADE: "", VITE_FUND_ANYCHAIN: "1", VITE_RYSK_MOCK: "1" }, [".js", ".css"]);
  for (const { f, src } of files) {
    expect(FUNDING_MARKER.test(src), f).toBe(false);
    expect(RYSK_MARKER.test(src), f).toBe(false);
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
