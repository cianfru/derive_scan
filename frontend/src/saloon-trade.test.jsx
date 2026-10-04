import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { encodeRfqExecute } from "@derivexyz/derive-ts/codecs";
import btc from "./fixtures/questions/BTC.json";
import hype from "./fixtures/questions/HYPE.json";
import index from "./fixtures/questions/index.json";
import hist from "./fixtures/questions/history-BTC-20261009.json";
import shapes from "./fixtures/trade/private_shapes.json";
import frames from "./fixtures/trade/public_frames.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: false, tradeMode: () => "dryrun" }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import { BANNED, findLevel, ticket } from "./lib/questions.js";
import { saveBudget } from "./lib/follows.js";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { createClient } from "./lib/trade/derive.js";
import { fakeDerive } from "./lib/trade/fakeSocket.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { actionDigest, actionHash, keyFromSecret } from "./lib/trade/sign.js";
import { PROTOCOL } from "./lib/trade/config.js";

const T14 = 1791036000;
const ID = "BTC-20261009-A-82000-88000";
const newKey = () => keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
let fake;
let wallet;

/** Derive's public/execute_quote_debug, worked out from the request the way Derive does (the byte-for-byte
 * proof against V3 testnet itself is in lib/trade/derive.test.js). */
function debugAnswer(p) {
  const ins = Object.fromEntries(frames.frames.filter((f) => f.method === "public/get_instrument" && f.frame.result).map((f) => [f.frame.result.instrument_name, f.frame.result]));
  const legs = p.legs.map((l) => ({ instrumentName: l.instrument_name, assetAddress: ins[l.instrument_name].base_asset_address, subId: ins[l.instrument_name].base_asset_sub_id, price: l.price, amount: l.amount, direction: l.direction }));
  const data = encodeRfqExecute({ maxFee: p.max_fee, direction: p.direction, legs });
  const f = { subaccountId: p.subaccount_id, nonce: p.nonce, module: PROTOCOL.rfqModule, data, expirySec: p.signature_expiry_sec, owner: wallet.address, signer: p.signer };
  return { encoded_data: data, encoded_data_hashed: keccak256(data), action_hash: actionHash(f), typed_data_hash: actionDigest(f, 11155111) };
}

function setup({ funded = true, keyGrant = (p) => p } = {}) {
  const subs = structuredClone(shapes["private/get_subaccount"]);
  if (!funded) subs[90212].collaterals = [];
  fake = fakeDerive({
    recorded: frames.frames,
    handlers: {
      "public/login": shapes["public/login"],
      "private/get_subaccounts": shapes["private/get_subaccounts"],
      "private/get_subaccount": ({ subaccount_id }) => subs[subaccount_id],
      "public/register_deposit_address": shapes["public/register_deposit_address"],
      "public/get_pending_deposits": shapes["public/get_pending_deposits"],
      "private/set_session_key": (p) => keyGrant({ public_session_key: p.public_session_key, protocol_scopes: p.protocol_scopes, offchain_scopes: p.offchain_scopes, subaccount_ids: p.subaccount_ids, expiry_sec: p.expiry_sec, label: p.label, ip_whitelist: [] }),
      "private/send_rfq": shapes["private/send_rfq"],
      "private/rfq_get_best_quote": shapes["private/rfq_get_best_quote"],
      "private/cancel_rfq": "ok",
      "public/execute_quote_debug": debugAnswer,
    },
  });
  wallet = fakeWallet();
  _setSeatDeps({
    findProvider: () => wallet,
    createClient: () => createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }),
    newKey,
  });
}

const show = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/q/:id" element={<Questions />} /><Route path="/saloon/:und" element={<Questions />} /></Routes>
  </MemoryRouter>,
);

/** Every word on screen, with every (i) in the ticket opened, passes the Saloon's word check. */
async function wordcheck(user, root) {
  for (const b of within(root).queryAllByRole("button", { expanded: false }).filter((x) => x.classList.contains("info"))) {
    await user.click(b);
    expect(document.body.textContent).not.toMatch(BANNED);
    await user.click(b);
  }
  expect(root.textContent).not.toMatch(BANNED);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  localStorage.clear();
  docs.current = { "questions/index.json": index, "questions/BTC.json": btc, "questions/HYPE.json": hype, "questions/history/BTC-20261009.json": hist, "markets.json": { coins: [] } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("one tap through Derive (testnet, dry run)", () => {
  it("walks connect, terms, approval and a dry run, and fills nothing", async () => {
    setup();
    // The recorded testnet quote is for 0.03299 contracts, what $100 bought before fees. Amounts are
    // the total with fees now, so the budget here is that ticket's total, rounded up to the cent.
    const level = findLevel(btc, ID).level;
    saveBudget(Math.ceil(ticket(level, "yes", 100, btc).mostLose * 100) / 100);
    const user = userEvent.setup();
    show(`/q/${ID}?side=yes`);
    expect(screen.queryByRole("region", { name: "Higher through Derive" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    expect(within(panel).getByText("Testnet · dry run")).toBeTruthy();
    await wordcheck(user, panel);

    await user.click(within(panel).getByRole("button", { name: "Connect wallet" }));
    await within(panel).findByText("Derive is not open to everyone.");
    const go = within(panel).getByRole("button", { name: "Continue" });
    expect(go.disabled).toBe(true);
    await wordcheck(user, panel);
    await user.click(within(panel).getByRole("checkbox"));
    await user.click(go);

    // The plain-English panel comes before any wallet prompt for the grant.
    await within(panel).findByText("Let Cowboy place Saloon trades");
    expect(within(panel).getByText(/Cowboy cannot withdraw, transfer, or touch your other Derive accounts/)).toBeTruthy();
    expect(wallet.calls.map((c) => c.method)).not.toContain("eth_signTypedData_v4");
    expect(wallet.calls.filter((c) => c.method === "personal_sign")).toHaveLength(1);
    await wordcheck(user, panel);
    await user.click(within(panel).getByRole("button", { name: "Approve in wallet" }));

    await within(panel).findByText(/Cowboy approved until/);
    expect(fake.calls("private/set_session_key")[0].params).toMatchObject({ protocol_scopes: ["trade:rfq:option"], subaccount_ids: [90212] });
    // Most you can lose comes first, from the board, before Derive is asked.
    const figs = within(panel).getAllByRole("term").map((t) => t.textContent);
    expect(figs[0]).toBe("Most you can lose");
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
    await wordcheck(user, panel);

    await user.click(within(panel).getByRole("button", { name: "Get price" }));
    const buy = await within(panel).findByRole("button", { name: "Dry run: buy for $98.33" });
    expect(within(panel).getByText(/49c per \$1/)).toBeTruthy();
    expect(fake.calls("private/send_rfq")[0].params).toMatchObject({ subaccount_id: 90212, max_total_cost: "103.95", label: `${ID}:yes`,
      legs: [{ instrument_name: "BTC-20261009-82000-C", direction: "buy", amount: "0.03299" }, { instrument_name: "BTC-20261009-88000-C", direction: "sell", amount: "0.03299" }] });
    await wordcheck(user, panel);

    await user.click(buy);
    await within(panel).findByText(/matches, byte for byte. Nothing filled./);
    expect(fake.calls("public/execute_quote_debug")).toHaveLength(1);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    expect(fake.log.some((m) => m.method === "private/execute_quote")).toBe(false);
    // The trading key signed in after approval; no further wallet prompts for the price or the dry run.
    expect(wallet.calls.filter((c) => c.method === "personal_sign")).toHaveLength(1);
    await wordcheck(user, panel);
  });

  it("asks for USDC when the Saloon account is empty, with the minimum and the deposit address", async () => {
    setup({ funded: false });
    localStorage.setItem("cowboy-saloon-terms:testnet", JSON.stringify({ at: 1 }));
    const user = userEvent.setup();
    show(`/q/${ID}?side=yes`);
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    await user.click(within(panel).getByRole("button", { name: "Connect wallet" }));
    await within(panel).findByText("Add USDC to your Saloon account");
    expect(fake.calls("public/register_deposit_address")[0].params).toEqual({ wallet: wallet.address, subaccount_id: 90212 });
    expect(within(panel).getByText(/0x9a3c…0912/)).toBeTruthy();
    expect(within(panel).getByText("$100.00")).toBeTruthy(); // arriving
    const amount = within(panel).getByLabelText("Deposit amount");
    await user.clear(amount);
    await user.type(amount, "5");
    expect(within(panel).getByText("The smallest deposit is $10.")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Send \$5 USDC/ }).disabled).toBe(true);
    await wordcheck(user, panel);
  });

  it("keeps stage 1's ticket one tap from order review, and alone for coins outside BTC and ETH", async () => {
    setup();
    const user = userEvent.setup();
    show(`/q/${ID}?side=yes`);
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    await user.click(within(panel).getByRole("button", { name: "Place by hand" }));
    expect(within(panel).getByText("Place these two orders on Derive, in this order.")).toBeTruthy();
    cleanup();
    // The old HYPE credit package stays unavailable; use its live debit neighbour to verify
    // that an actual order review outside BTC/ETH exposes the manual ticket alone.
    show("/q/HYPE-20261009-A-85-91?side=yes");
    expect(screen.getByRole("button", { name: "Review orders" }).disabled).toBe(true);
    expect(screen.queryByRole("region", { name: /through Derive/ })).toBeNull();
    cleanup();
    show("/q/HYPE-20261009-A-89-95?side=yes");
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    expect(await screen.findByRole("region", { name: "Place on Derive" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /through Derive/ })).toBeNull();
  });
});
