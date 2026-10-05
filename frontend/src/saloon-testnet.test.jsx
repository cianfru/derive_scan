// Saloon stage 2, P6 on screen: a testnet build buys an answer in one tap, finds it in Positions from
// Derive's own records, checks it against the Saloon account, sells it back, and honours the kill
// switch. Derive is a fake socket answering with frames built from Derive's openapi shapes.
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { keccak256, toUtf8Bytes } from "ethers";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";
import hist from "./fixtures/questions/history-BTC-20261009.json";
import shapes from "./fixtures/trade/private_shapes.json";
import frames from "./fixtures/trade/public_frames.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, tradeMode: () => "testnet" }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";
import Shell from "./components/Shell.jsx";
import { BANNED, findLevel, ticket } from "./lib/questions.js";
import { saveBudget } from "./lib/follows.js";
import { loadPositions, _resetMemory } from "./lib/positions.js";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { EXECUTE, createClient } from "./lib/trade/derive.js";
import { fakeDerive } from "./lib/trade/fakeSocket.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { keyFromSecret } from "./lib/trade/sign.js";
import { TESTNET_WS } from "./lib/trade/config.js";

const T14 = 1791036000;
const ID = "BTC-20261009-A-82000-88000";
const C82 = "BTC-20261009-82000-C", C88 = "BTC-20261009-88000-C";
const BUY_RFQ = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0", SELL_RFQ = "1f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f1";
const newKey = () => keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
let fake, wallet, held, trades;

const quote = (direction, total, fee, prices) => {
  const b = shapes["private/rfq_get_best_quote"];
  return { ...b, direction, estimated_total_cost: total, estimated_fee: fee,
    best_quote: { ...b.best_quote, rfq_id: direction === "buy" ? BUY_RFQ : SELL_RFQ, direction: direction === "buy" ? "sell" : "buy",
      legs: [{ instrument_name: C82, direction: "buy", amount: "0.03299", price: prices[0] }, { instrument_name: C88, direction: "sell", amount: "0.03299", price: prices[1] }] } };
};
const row = (rfq, q, name, direction, price, fee, ts, label) => ({
  trade_id: `${rfq.slice(0, 8)}-${name.slice(-7, -2)}-4000-8000-000000000000`, instrument_name: name, timestamp: ts, trade_price: price, trade_amount: "0.03299",
  mark_price: price, index_price: "84823.1", direction, quote_id: q, rfq_id: rfq, subaccount_id: 90212, batch_status: "Settled", tx_hash: null,
  trade_fee: fee, expected_rebate: "0", liquidity_role: "taker", realized_pnl: "0", realized_pnl_excl_fees: "0", extra_fee: "0", label, is_transfer: false, op_uuid: "x", order_id: "y",
});

function setup() {
  held = [];
  trades = [];
  const subs = structuredClone(shapes["private/get_subaccount"]);
  fake = fakeDerive({
    recorded: frames.frames,
    handlers: {
      "public/login": shapes["public/login"],
      "private/get_subaccounts": shapes["private/get_subaccounts"],
      "private/get_subaccount": ({ subaccount_id }) => subs[subaccount_id],
      "private/set_session_key": (p) => ({ public_session_key: p.public_session_key, protocol_scopes: p.protocol_scopes, offchain_scopes: p.offchain_scopes, subaccount_ids: p.subaccount_ids, expiry_sec: p.expiry_sec, label: p.label, ip_whitelist: [] }),
      "private/send_rfq": (p) => ({ ...shapes["private/send_rfq"], rfq_id: p.max_total_cost ? BUY_RFQ : SELL_RFQ, label: p.label }),
      "private/rfq_get_best_quote": (p) => (p.direction === "buy" ? quote("buy", "96.9906", "1.3395", ["3180", "240"]) : quote("sell", "92.6", "1.3", ["3000", "193.0942"])),
      "private/cancel_rfq": "ok",
      [EXECUTE]: (p) => {
        const buy = p.direction === "buy";
        const rfq = buy ? BUY_RFQ : SELL_RFQ, q = buy ? "aaaaaaaa-0000-4000-8000-000000000001" : "bbbbbbbb-0000-4000-8000-000000000002";
        const ts = (T14 + (buy ? 700 : 900)) * 1000;
        const label = buy ? `${ID}:yes` : `${ID}:yes:close`;
        trades.push(row(rfq, q, C82, buy ? "buy" : "sell", buy ? "3180" : "3000", buy ? "1.3395" : "1.3", ts, label),
          row(rfq, q, C88, buy ? "sell" : "buy", buy ? "240" : "193.0942", "0", ts, label));
        held = buy ? [{ instrument_name: C82, instrument_type: "option", amount: "0.03299" }, { instrument_name: C88, instrument_type: "option", amount: "-0.03299" }] : [];
        return { cancel_reason: "", creation_timestamp: ts, direction: p.direction, extra_fee: "0", fee: buy ? "1.3395" : "1.3", fill_pct: "1", is_transfer: false, label,
          last_update_timestamp: ts, legs: p.legs, legs_hash: "0x11", liquidity_role: "taker", max_fee: p.max_fee, mmp: false, nonce: p.nonce, quote_id: q,
          rfq_filled_pct: "1", rfq_id: rfq, signature_expiry_sec: p.signature_expiry_sec, status: "filled", subaccount_id: 90212 };
      },
      "private/get_trade_history": (p) => ({ subaccount_id: 90212, trades: trades.filter((t) => !p.quote_id || t.quote_id === p.quote_id), pagination: { count: trades.length, num_pages: 1 } }),
      "private/get_positions": () => ({ subaccount_id: 90212, positions: held }),
    },
  });
  wallet = fakeWallet();
  _setSeatDeps({
    findProvider: () => wallet,
    createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }),
    newKey,
  });
}

const page = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/q/:id" element={<Questions />} />
      <Route path="/saloon/mine" element={<MyQuestions />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  localStorage.clear();
  _resetMemory();
  docs.current = { "questions/index.json": index, "questions/BTC.json": btc, "questions/history/BTC-20261009.json": hist, "markets.json": { coins: [] } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("one tap on Derive's testnet", () => {
  it("buys, records the fill exactly, shows it in Positions from Derive and sells it back", async () => {
    setup();
    const level = findLevel(btc, ID).level;
    saveBudget(Math.ceil(ticket(level, "yes", 100, btc).mostLose * 100) / 100);
    const user = userEvent.setup();
    page(`/q/${ID}?side=yes`);
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    // The testnet badge, and what it means, on the trade screen.
    expect(within(panel).getByText("Testnet")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "About testnet" }));
    expect(document.body.textContent).toMatch(/One-tap trades in this build go to Derive's testnet with test USDC/);
    await user.click(within(panel).getByRole("button", { name: "About testnet" }));
    await user.click(within(panel).getByRole("button", { name: "Connect wallet" }));
    await user.click(await within(panel).findByRole("checkbox"));
    await user.click(within(panel).getByRole("button", { name: "Continue" }));
    await user.click(await within(panel).findByRole("button", { name: "Approve Cowboy" }));
    await within(panel).findByText(/Cowboy approved until/);

    await user.click(within(panel).getByRole("button", { name: "Get price" }));
    const buy = await within(panel).findByRole("button", { name: "Buy for $98.33" });
    expect(within(panel).getByText(/Derive testnet, test USDC/)).toBeTruthy();
    await user.click(buy);
    await within(panel).findByText(/Bought 0.03299 contracts for/);
    expect(within(panel).getByText("$98.33")).toBeTruthy();
    expect(fake.calls(EXECUTE)).toHaveLength(1);
    expect(fake.calls("public/execute_quote_debug")).toHaveLength(0);
    expect(panel.textContent).not.toMatch(BANNED);

    // The journal holds the fill, exactly as Derive recorded it, under the testnet key.
    const [p] = loadPositions("testnet");
    expect(loadPositions("mainnet")).toHaveLength(0);
    expect(p).toMatchObject({ id: ID, side: "yes", exec: "rfq", contracts: 0.03299, network: "testnet" });
    expect(p.journal).toMatchObject({ source: "derive", entered_by_you: [] });
    expect(p.journal.fill).toMatchObject({ ts: T14 + 700, premium: 96.9906, fees: 1.3395, rfq_id: BUY_RFQ });
    expect(p.journal.fill.trade_ids).toHaveLength(2);
    expect(p.journal.cost).toMatchObject({ total: 98.3301, fees_basis: "exact" });
    cleanup();

    // Positions on the testnet build reads the Saloon account and finds the answer held.
    vi.setSystemTime((T14 + 800) * 1000);
    page("/saloon/mine");
    const sync = await screen.findByRole("region", { name: "Your Saloon account on Derive" });
    await within(sync).findByText(/Checked with Derive at/);
    expect(fake.calls("private/get_positions")).toHaveLength(1);
    const card = document.querySelector(".q-position");
    expect(within(card).getByText("Bought in one tap")).toBeTruthy();
    expect(within(card).getByText("On Derive: held")).toBeTruthy();
    expect(within(card).getAllByText("$98.33").length).toBeGreaterThan(0);
    await user.click(within(card).getByText("Position details"));
    await user.click(within(card).getByText("Entry record"));
    expect(within(card).getAllByText("From Derive").length).toBeGreaterThan(1);
    expect(within(card).queryByText("Entered by you")).toBeNull();

    // Sell back through Derive: the same package the other way, its floor from the board.
    await user.click(within(card).getByRole("button", { name: "Close" }));
    const sell = await screen.findByRole("region", { name: "Sell back Higher through Derive" });
    await user.click(within(sell).getByRole("button", { name: "Get sell-back price" }));
    const go = await within(sell).findByRole("button", { name: "Sell for $91.30" });
    expect(fake.calls("private/send_rfq").at(-1).params).toMatchObject({ min_total_cost: "88.64", label: `${ID}:yes:close` });
    await user.click(go);
    await screen.findByText("Nothing open right now");
    await user.click(screen.getByRole("tab", { name: "Closed" }));
    expect(await screen.findByText("Closed · sold back in one tap")).toBeTruthy();
    expect(screen.getAllByText("Realized P/L").length).toBeGreaterThan(0);
    const [after] = loadPositions("testnet");
    expect(after.exits[0]).toMatchObject({ kind: "close", via: "rfq", fees: 1.3, fees_basis: "exact", gross_basis: "exact", rfq_id: SELL_RFQ, ts: T14 + 900 });
    expect(after.exits[0].gross).toBeCloseTo(92.6, 3); // from Derive's trade prices
    expect(after.exits[0].trade_ids).toHaveLength(2);
    expect(after.closed_at).toBeTruthy();
    expect(fake.calls(EXECUTE)).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(BANNED);
  }, 30_000);

  it("adds a fill this browser missed from Derive's records", async () => {
    setup();
    trades.push(row(BUY_RFQ, "q1", C82, "buy", "3180", "1.3395", (T14 + 700) * 1000, `${ID}:yes`), row(BUY_RFQ, "q1", C88, "sell", "240", "0", (T14 + 700) * 1000, `${ID}:yes`));
    held = [{ instrument_name: C82, instrument_type: "option", amount: "0.03299" }, { instrument_name: C88, instrument_type: "option", amount: "-0.03299" }];
    localStorage.setItem("cowboy-saloon-terms:testnet", JSON.stringify({ at: 1 }));
    const user = userEvent.setup();
    page("/saloon/mine");
    const sync = await screen.findByRole("region", { name: "Your Saloon account on Derive" });
    await user.click(within(sync).getByRole("button", { name: "Connect wallet" }));
    await within(sync).findByText(/1 added from Derive's records/);
    expect(loadPositions("testnet")[0]).toMatchObject({ id: ID, exec: "rfq", recovered: true, paid: 98.3301 });
    expect(await screen.findByText("On Derive: held")).toBeTruthy();
  });

  it("shows the kill switch plainly: sell_only stops buys, off stops both", async () => {
    setup();
    localStorage.setItem("cowboy-saloon-terms:testnet", JSON.stringify({ at: 1 }));
    const user = userEvent.setup();
    docs.current["questions/index.json"] = { ...index, trading: "sell_only" };
    page(`/q/${ID}?side=yes`);
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    expect(within(panel).getAllByText("Cowboy has paused new buys. Selling back still works.").length).toBeGreaterThan(0);
    cleanup();
    docs.current["questions/index.json"] = { ...index, trading: "off" };
    page(`/q/${ID}?side=yes`);
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const off = await screen.findByRole("region", { name: "Higher through Derive" });
    expect(within(off).getAllByText(/Cowboy has paused one-tap trading/).length).toBeGreaterThan(0);
    expect(within(off).queryByRole("button", { name: "Get price" })).toBeNull();
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("carries a Testnet badge in the header", () => {
    window.scrollTo = () => {};
    render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    expect(screen.getByLabelText("Cowboy home, testnet build").textContent).toMatch(/Testnet/);
  });
});

// The header's wallet: the same seat as every ticket, so connecting, approving, switching off and
// disconnecting in one shows in the other.
const withShell = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="/q/:id" element={<Questions />} />
        <Route path="/saloon/mine" element={<MyQuestions />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);
const header = () => document.querySelector("header.hdr");
/** The header's own control, once the trade chunk has loaded (the placeholder has no wallet menu yet). */
const headerWallet = async () => {
  await waitFor(() => expect(document.querySelector(".hw-btn")?.dataset.ready).toBe("1"));
  return within(header()).getByRole("button", { name: /^(Connect wallet|Wallet 0x)/ });
};

describe("the wallet in the header", () => {
  beforeEach(() => { window.scrollTo = () => {}; });

  it("connects from the header, and the ticket carries on from there", async () => {
    setup();
    const user = userEvent.setup();
    withShell(`/q/${ID}?side=yes`);
    const btn = await headerWallet();
    expect(btn.textContent).toMatch(/Connect wallet/);
    await user.click(btn);
    // Derive's terms come first, in the header's menu, with focus on the checkbox.
    const menu = await within(header()).findByRole("group", { name: "Your wallet" });
    const box = within(menu).getByRole("checkbox");
    expect(document.activeElement).toBe(box);
    expect(within(header()).getByRole("button", { name: `Wallet ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` }).textContent)
      .toMatch(new RegExp(`${wallet.address.slice(0, 4)}…${wallet.address.slice(-2)}`));

    // The ticket sees the same connection: no second "Connect wallet", the same terms step.
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    expect(within(panel).queryByRole("button", { name: "Connect wallet" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Continue" })).toBeTruthy();

    // Signing in from the header moves the ticket on to the approval.
    await user.click(within(header()).getByRole("button", { name: /^Wallet 0x/ }));
    const again = await within(header()).findByRole("group", { name: "Your wallet" });
    await user.click(within(again).getByRole("checkbox"));
    await user.click(within(again).getByRole("button", { name: "Continue" }));
    const account = await within(again).findByRole("link", { name: /Derive account/ });
    expect(account.getAttribute("href")).toBe("/saloon/mine");
    await waitFor(() => expect(document.activeElement).toBe(account));
    expect(account.textContent).toMatch(/Approval needed\$240\.50/);
    expect(within(again).queryByRole("button", { name: "Switch off Cowboy" })).toBeNull();
    await within(panel).findByRole("button", { name: "Approve Cowboy" });

    // Approving in the ticket (a tap outside closes the header's menu) shows as ready in the header.
    await user.click(within(panel).getByRole("button", { name: "Approve Cowboy" }));
    expect(within(header()).queryByRole("group", { name: "Your wallet" })).toBeNull();
    await within(panel).findByText(/Cowboy approved until/);
    await user.click(within(header()).getByRole("button", { name: /^Wallet 0x/ }));
    const ready = within(header()).getByRole("group", { name: "Your wallet" });
    expect(within(ready).getByRole("link", { name: /Derive account/ }).textContent).toMatch(/Ready\$240\.50/);
    expect(within(ready).getByText(/Cowboy approved until/)).toBeTruthy();

    // Switching off in the header takes the ticket back to the approval.
    await user.click(within(ready).getByRole("button", { name: "Switch off Cowboy" }));
    await within(ready).findByText(/Switched off/);
    expect(fake.calls("private/set_session_key")).toHaveLength(2);
    expect(within(ready).getByRole("link", { name: /Derive account/ }).textContent).toMatch(/Approval needed/);
    expect(within(ready).queryByRole("button", { name: "Switch off Cowboy" })).toBeNull();
    await within(panel).findByRole("button", { name: "Approve Cowboy" });

    // Disconnect: both go back to "Connect wallet", focus returns to the header's button.
    await user.click(within(ready).getByRole("button", { name: "Disconnect" }));
    const plain = within(header()).getByRole("button", { name: "Connect wallet" });
    expect(document.activeElement).toBe(plain);
    expect(within(header()).queryByRole("group", { name: "Your wallet" })).toBeNull();
    await within(panel).findByRole("button", { name: "Connect wallet" });
    expect(document.body.textContent).not.toMatch(BANNED);
  }, 30_000);

  it("shows a connection made in the ticket; Escape closes the menu and returns focus", async () => {
    setup();
    localStorage.setItem("cowboy-saloon-terms:testnet", JSON.stringify({ at: 1 }));
    const user = userEvent.setup();
    withShell(`/q/${ID}?side=yes`);
    await headerWallet();
    await user.click(screen.getByRole("button", { name: "Review orders" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    await user.click(within(panel).getByRole("button", { name: "Connect wallet" }));
    await within(panel).findByRole("button", { name: "Approve Cowboy" });
    const btn = within(header()).getByRole("button", { name: /^Wallet 0x/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await user.click(btn);
    const menu = within(header()).getByRole("group", { name: "Your wallet" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(menu).getByRole("link", { name: /Derive account/ }));
    await user.keyboard("{Escape}");
    expect(within(header()).queryByRole("group", { name: "Your wallet" })).toBeNull();
    expect(document.activeElement).toBe(btn);
    // The Saloon account link opens Positions, which reads the same connection.
    await user.click(btn);
    await user.click(within(header()).getByRole("link", { name: /Derive account/ }));
    const sync = await screen.findByRole("region", { name: "Your Saloon account on Derive" });
    expect(within(header()).queryByRole("group", { name: "Your wallet" })).toBeNull();
    await within(sync).findByRole("button", { name: "Check again" });
    expect(within(sync).queryByRole("button", { name: "Connect wallet" })).toBeNull();
  });

  it("says plainly when the browser has no wallet", async () => {
    setup();
    _setSeatDeps({ findProvider: () => null });
    const user = userEvent.setup();
    withShell(`/q/${ID}?side=yes`);
    await user.click(await headerWallet());
    expect((await within(header()).findByRole("status")).textContent).toMatch(/needs a browser wallet such as MetaMask or Rabby/);
    expect(within(header()).getByRole("button", { name: "Connect wallet" })).toBeTruthy();
  });
});
