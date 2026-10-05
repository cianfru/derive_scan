// UI safety at the asynchronous boundary: all Derive reads, quotes and executions are mocked.
// A wallet switch must hide the old scope immediately and never turn a late result into a trade.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import index from "./fixtures/questions/index.json";
import btc from "./fixtures/questions/BTC.json";
import rec from "./fixtures/trade/testnet_rfq_trades.json";

const mock = vi.hoisted(() => ({ docs: {}, reads: [], settlements: [], rfqs: [] }));
vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, tradeMode: () => "testnet" }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: mock.docs[path] || null }) }));
vi.mock("./lib/testnetLevels.js", async () => ({ ...await vi.importActual("./lib/testnetLevels.js"), useTestnetListing: () => null }));
vi.mock("./lib/trade/sync.js", async () => ({ ...await vi.importActual("./lib/trade/sync.js"),
  readSaloon: (client, id, options) => new Promise((resolve) => mock.reads.push({ client, id, options, resolve })),
  settlementPrice: (client, und, expiry) => new Promise((resolve) => mock.settlements.push({ client, und, expiry, resolve })),
}));
vi.mock("./lib/trade/sessionKey.js", async () => ({ ...await vi.importActual("./lib/trade/sessionKey.js"), keySigner: () => ({}) }));
vi.mock("./lib/trade/rfq.js", async () => ({ ...await vi.importActual("./lib/trade/rfq.js"),
  createTicket: (params) => {
    const ticket = { params, start: vi.fn(), close: vi.fn(), confirm: vi.fn() };
    mock.rfqs.push(ticket);
    return ticket;
  },
}));
import MyQuestions from "./pages/MyQuestions.jsx";
import TradePanel, { DeriveSync } from "./components/trade/TradePanel.jsx";
import TradeTicket, { sellPlan } from "./components/trade/TradeTicket.jsx";
import { _setSeatState, seatState } from "./lib/trade/seat.js";
import { addPosition, closePosition, loadPositions, savePositions, _resetMemory } from "./lib/positions.js";
import { fillFromTrades } from "./lib/trade/fills.js";
import { buyRecord, exitFromFill } from "./lib/trade/record.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const NOW = Date.UTC(2026, 9, 4, 4);
const ID = "BTC-20261005-A-90000-92000";
const rows = (id = 8101) => rec.taker.map((t) => ({ ...t, subaccount_id: id, label: `${ID}:yes` }));
const fill = () => ({ ...fillFromTrades(rows(), { rfqId: rec.rfq_id }), pct: 1 });
const record = (wallet = A, id = 8101) => buyRecord({ fill: fill(), id: ID, side: "yes", savedTs: NOW / 1000, wallet, subaccountId: id });
const seat = (wallet, id) => ({ stage: "ready", wallet, saloon: { id, usdc: 100 }, client: {}, key: { expiry_sec: NOW / 1000 + 86400 } });
const page = (element, path = "/saloon/mine") => render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
const finishRead = async (i, trades = []) => act(async () => mock.reads[i].resolve({ trades, held: new Map() }));
const quote = () => ({ phase: "quoted", check: { ok: true, total: 1, net: 1, mostLose: 1, fee: 0, perDollar: .05 }, firmUntil: NOW + 30_000 });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  localStorage.clear(); _resetMemory();
  mock.reads.length = 0; mock.settlements.length = 0; mock.rfqs.length = 0;
  mock.docs = { "questions/index.json": { ...index, trading: "on" }, "questions/BTC.json": btc };
  _setSeatState(seat(A, 8101));
});
afterEach(() => { cleanup(); _setSeatState({}); vi.restoreAllMocks(); });

describe("ownership before selling back", () => {
  it.each(["both", "wallet", "subaccount"])("blocks a legacy RFQ missing %s scope until Derive finds the entry on the current account", async (missing) => {
    const legacy = record();
    if (missing === "both" || missing === "wallet") delete legacy.wallet;
    if (missing === "both" || missing === "subaccount") delete legacy.subaccount_id;
    addPosition(legacy, NOW);
    page(<MyQuestions />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    await finishRead(0);
    expect(await screen.findByText("Another Derive account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(mock.rfqs).toHaveLength(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await finishRead(1, rows());
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await user.click(await screen.findByRole("button", { name: "Get sell-back price" }));
    expect(mock.rfqs[0].params).toMatchObject({ subaccountId: 8101, owner: A, direction: "sell" });
    expect(loadPositions("testnet")[0]).toMatchObject({ wallet: A, subaccount_id: 8101 });
  });

  it("offers Close with no wallet connected; the panel connects first and opens no ticket", async () => {
    addPosition(record(), NOW);
    _setSeatState({ stage: "disconnected" });
    page(<MyQuestions />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Close" }));
    const panel = await screen.findByRole("region", { name: /^Sell back/ });
    expect(within(panel).getByRole("button", { name: "Connect wallet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get sell-back price" })).toBeNull();
    expect(mock.reads).toHaveLength(0);
    expect(mock.rfqs).toHaveLength(0);
  });

  it.each(["unclaimed", "wallet", "account"])("blocks a direct sell ticket with %s ownership", (kind) => {
    const p = record(kind === "wallet" ? B : A, kind === "account" ? 8102 : 8101);
    if (kind === "unclaimed") { delete p.wallet; delete p.subaccount_id; }
    page(<TradePanel und="BTC" question="BTC above 90,000?" answer="Higher" sell={{ position: p }} />);
    expect(screen.queryByRole("button", { name: "Get sell-back price" })).toBeNull();
    expect(mock.rfqs).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(kind === "unclaimed" ? /confirm its wallet and account/ : /Connect its wallet and choose that account/);
  });

  it("reads far enough back to verify a wallet-only legacy entry older than the default history window", async () => {
    const legacy = record(); delete legacy.subaccount_id;
    legacy.journal.fill.ts = NOW / 1000 - 45 * 86400;
    addPosition(legacy, NOW);
    page(<DeriveSync />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    expect(mock.reads[0].options.sinceSec).toBe(legacy.journal.fill.ts - 3600);
  });
});

describe("scope changes during Derive reads", () => {
  it("discards an older wallet's completed read before it publishes or adds its trades", async () => {
    const synced = vi.fn(), scoped = vi.fn();
    page(<DeriveSync onSynced={synced} onScope={scoped} />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    act(() => _setSeatState(seat(B, 8102)));
    expect(scoped.mock.lastCall[0]).toMatchObject({ wallet: B, subaccountId: 8102 });
    await waitFor(() => expect(mock.reads).toHaveLength(2));
    await finishRead(1);
    await finishRead(0, rows());
    expect(synced).toHaveBeenCalledTimes(1);
    expect(synced.mock.lastCall[0]).toMatchObject({ wallet: B, subaccountId: 8102 });
    expect(loadPositions("testnet")).toHaveLength(0);
  });

  it("does not settle an old account when its settlement price arrives after switching", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 6, 4));
    addPosition(record(), NOW);
    const synced = vi.fn();
    page(<DeriveSync onSynced={synced} />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    await finishRead(0, rows());
    expect(mock.settlements).toHaveLength(1);
    act(() => _setSeatState(seat(B, 8102)));
    await waitFor(() => expect(mock.reads).toHaveLength(2));
    await finishRead(1);
    await act(async () => mock.settlements[0].resolve(91_000));
    expect(loadPositions("testnet")[0].exits || []).toHaveLength(0);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(synced.mock.lastCall[0].wallet).toBe(B);
  });

  it("filters by the new wallet before its read finishes and clears old account statuses", async () => {
    addPosition({ ...record(), key: "a" }, NOW);
    const other = { ...record(B, 8102), key: "b" };
    other.journal.fill.rfq_id = "other-wallet-buy";
    addPosition(other, NOW);
    expect(loadPositions("testnet")).toHaveLength(2);
    page(<MyQuestions />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    await finishRead(0);
    expect(document.querySelectorAll(".q-position")).toHaveLength(1);
    expect(screen.getByText("Differs from Derive")).toBeTruthy();
    act(() => _setSeatState(seat(B, 8102)));
    await waitFor(() => expect(mock.reads).toHaveLength(2));
    expect(document.querySelectorAll(".q-position")).toHaveLength(1);
    expect(screen.queryByText("Differs from Derive")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Get sell-back price" }));
    expect(mock.rfqs[0].params.owner).toBe(B);
  });
});

describe("an RFQ already open when the seat changes", () => {
  it.each(["wallet", "account", "key", "client", "disconnect"])("invalidates quote controls on a %s change, while preserving the original dispatched fill scope", async (kind) => {
    const original = seatState();
    const onFill = vi.fn();
    page(<TradeTicket plan={sellPlan({ position: record() })} onFill={onFill} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Get sell-back price" }));
    const old = mock.rfqs[0];
    act(() => old.params.onChange(quote()));
    const confirm = screen.getByRole("button", { name: "Sell for $1.00" });
    const next = kind === "wallet" ? seat(B, 8102)
      : kind === "account" ? { ...original, saloon: { ...original.saloon, id: 8102 } }
      : kind === "key" ? { ...original, key: { ...original.key } }
      : kind === "client" ? { ...original, client: {} }
      : { stage: "disconnected", wallet: null, client: null, key: null, saloon: null };
    act(() => { _setSeatState(next); fireEvent.click(confirm); });
    expect(old.close).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sell for $1.00" })).toBeNull();
    await user.click(confirm); // a detached confirmation must not execute on the new seat
    expect(old.confirm).not.toHaveBeenCalled();
    act(() => { old.params.onChange(quote()); old.params.onKeyRejected(); });
    expect(screen.queryByRole("button", { name: "Sell for $1.00" })).toBeNull();
    expect(seatState().key).toBe(next.key);
    const result = fill();
    act(() => old.params.onFill(result));
    expect(onFill).toHaveBeenCalledExactlyOnceWith(result, { wallet: A, subaccountId: 8101 });
  });

  it("persists a dispatched buy under its original wallet and Derive account after switching", async () => {
    const level = { id: ID, lo: 90_000, hi: 92_000, yes: { buy: .05, legs: [["BTC-20261005-90000-C", "buy", 121], ["BTC-20261005-92000-C", "sell", 26]] } };
    page(<TradePanel und="BTC" question="BTC above 90,000?" answer="Higher" level={level} sideKey="yes" board={btc} t={{ contracts: .01, premium: 1, fees: .5, mostLose: 1.5 }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Get price" }));
    const old = mock.rfqs[0];
    act(() => _setSeatState(seat(B, 8102)));
    act(() => old.params.onFill(fill()));
    expect(loadPositions("testnet")).toHaveLength(1);
    expect(loadPositions("testnet")[0]).toMatchObject({ wallet: A, subaccount_id: 8101, id: ID });
  });
});

describe("trade receipts that are still incomplete", () => {
  it.each(["entry", "exit"])("withholds complete-answer value, combined exposure and sell-back controls for a pending %s", async (kind) => {
    const p = kind === "entry"
      ? buyRecord({ fill: { ...fillFromTrades(rows().filter((t) => t.instrument_name.includes("92000"))), complete: false }, id: ID, side: "yes", savedTs: NOW / 1000, wallet: A, subaccountId: 8101 })
      : record();
    const [saved] = addPosition(p, NOW);
    if (kind === "exit") closePosition(saved.key, { kind: "close", via: "rfq", complete: false, rfq_id: "pending-close", qty: .01, gross: 2, fees: .5, net: 1.5 }, NOW / 1000, "testnet");
    page(<MyQuestions />);
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    expect(screen.getByText(/These positions are left out of the combined settlement figures/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.queryByRole("region", { name: /^At settlement/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "About incomplete fills" })).toBeNull();
    const card = screen.getByRole("article");
    // Still shown, as its date's card, with the combined figures withheld.
    expect(card.classList.contains("q-group")).toBe(true);
    expect(card.querySelector("h2").textContent).toMatch(/^BTC · /);
    expect(within(card.querySelector(".q-position-figures")).getByText("Most you can lose").closest("div").querySelector("dd").textContent).toMatch(/Not available yet/);
    expect(within(card).getAllByText("Not available yet").length).toBeGreaterThanOrEqual(kind === "entry" ? 4 : 3);
    const paid = within(card).getByText("You paid").closest("div").querySelector("dd");
    expect(paid.textContent).toMatch(kind === "entry" ? /Not available yet/ : /\$1.60/);
    if (kind === "entry") {
      expect(p.paid).toBe(-.26);
      expect(card.querySelector(".q-position-figures").textContent).not.toMatch(/-\$0.26/);
      expect(card.querySelector(".q-entry").textContent).toMatch(/-\$0.26/);
    }
    expect(sellPlan({ position: loadPositions("testnet")[0] })).toBeNull();
    // Empty authoritative history cannot settle a pending receipt, even past expiry.
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 6, 4));
    await finishRead(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    await finishRead(1);
    expect(mock.settlements).toHaveLength(0);
  });

  it("does not display a legacy synthetic settlement payout while its entry receipt is incomplete", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 6, 4));
    const p = record(); p.journal.fill.complete = false;
    const [saved] = addPosition(p, NOW);
    savePositions([{ ...saved, closed_at: NOW / 1000, exits: [{ kind: "settle", qty: .01, settle_price: 91_000, gross: 10, fees: 0, net: 10, gross_basis: "exact" }] }], "testnet");
    page(<MyQuestions />, "/saloon/mine?tab=closed");
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    expect(screen.getByText("Settlement records still being checked")).toBeTruthy();
    expect(screen.queryByText("$10.00")).toBeNull();
    expect(screen.queryByText(/Settled at/)).toBeNull();
    expect(screen.queryByText(/Exact, from Derive's settlement price/)).toBeNull();
  });
});

it("repairs a historical two-lot close across a newly recovered entry in the same sync", async () => {
  const secondBuy = rows().map((t) => ({ ...t, rfq_id: "second-buy", trade_id: `${t.trade_id}-second`, timestamp: t.timestamp + 1000 }));
  const closeRows = rows().map((t) => ({ ...t, rfq_id: "two-lot-close", trade_id: `${t.trade_id}-close`, label: `${ID}:yes:close`,
    direction: t.direction === "buy" ? "sell" : "buy", trade_amount: "0.02", timestamp: t.timestamp + 100_000,
    trade_price: t.instrument_name.includes("90000") ? "160" : "40", trade_fee: t.instrument_name.includes("90000") ? "0.62" : "0" }));
  const [first] = addPosition(record(), NOW);
  const oldClose = exitFromFill(fillFromTrades(closeRows), { savedTs: NOW / 1000 });
  savePositions([{ ...first, exits: [{ ...oldClose, qty: .01 }], closed_at: NOW / 1000, proceeds: oldClose.net }], "testnet");
  const synced = vi.fn();
  page(<DeriveSync onSynced={synced} />);
  await waitFor(() => expect(mock.reads).toHaveLength(1));
  const history = [...rows(), ...secondBuy, ...closeRows];
  await finishRead(0, history);
  const persisted = loadPositions("testnet");
  expect(persisted).toHaveLength(2);
  expect(persisted.every((p) => p.closed_at && p.exits.length === 1)).toBe(true);
  expect(persisted.map((p) => p.exits[0].qty)).toEqual([.01, .01]);
  expect(persisted.map((p) => p.exits[0].gross)).toEqual([1.2, 1.2]);
  expect(persisted.map((p) => p.exits[0].fees)).toEqual([.31, .31]);
  expect(synced.mock.lastCall[0]).toMatchObject({ added: 1, repaired: 2, unmatched: [] });
  await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
  await finishRead(1, history);
  expect(loadPositions("testnet")).toEqual(persisted);
});

it("surfaces verified sell-back cash without a matching entry, outside profit and loss", async () => {
  const closeRows = rows().map((t) => ({ ...t, rfq_id: "unmatched-close", label: `${ID}:yes:close`, direction: t.direction === "buy" ? "sell" : "buy" }));
  const synced = vi.fn();
  page(<DeriveSync onSynced={synced} />);
  await waitFor(() => expect(mock.reads).toHaveLength(1));
  await finishRead(0, closeRows);
  expect(screen.getByRole("status").textContent).toMatch(/sell-back receipt needs matching entry records.*recorded.*received after fees.*out of profit and loss/);
  expect(loadPositions("testnet")).toHaveLength(0);
  expect(synced.mock.lastCall[0].unmatched).toHaveLength(1);
});

describe("a full receipt whose Derive fees are unavailable", () => {
  const unknownRows = () => rows().map((t, i) => i === 0 ? { ...t, trade_fee: undefined } : t);
  const figure = (region, label) => within(region).getByText(label, { selector: "dt" }).closest("div").querySelector("dd");
  it.each(["new", "legacy", "settled"])("keeps known payout separate from unknown fee-inclusive cost and P/L for a %s record", async (kind) => {
    const unknown = { ...fillFromTrades(unknownRows()), pct: 1 };
    expect(unknown.fees).toBeNull();
    const p = buyRecord({ fill: unknown, id: ID, side: "yes", savedTs: NOW / 1000, wallet: A, subaccountId: 8101 });
    if (kind !== "new") p.paid = p.journal.cost.premium; // old saved records held the premium here
    const level = { id: ID, lo: 90_000, hi: 92_000, k: 91_000, fair: .1, state: "open", yes: { buy: .1, sell: .08,
      legs: [["BTC-20261005-90000-C", "buy", 121], ["BTC-20261005-92000-C", "sell", 26]],
      close: [["BTC-20261005-92000-C", "buy", 26], ["BTC-20261005-90000-C", "sell", 121]] } };
    mock.docs["questions/BTC.json"] = { ...btc, prices_ts: NOW / 1000, index: 91_000, dates: [{ expiry: "20261005", settle_ts: p.settle_ts, levels: [level] }], settled: [] };
    if (kind === "settled") {
      vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 6, 4));
      mock.docs["questions/history/BTC-20261005.json"] = { settle_price: 91_000 };
    }
    addPosition(p, NOW);
    page(<MyQuestions />, kind === "settled" ? "/saloon/mine?tab=closed" : "/saloon/mine");
    await waitFor(() => expect(mock.reads).toHaveLength(1));
    const card = document.querySelector(".q-position"), top = card.querySelector(".q-position-figures");
    expect(figure(top, "You paid").textContent).toMatch(/Not available yet/);
    expect(within(top).getByText("Derive's fees unavailable")).toBeTruthy();
    expect(figure(top, kind === "settled" ? "Realized P/L" : "Profit / loss now").textContent).toMatch(/Not available yet/);
    if (kind === "settled") expect(figure(top, "Got").textContent).toBe("$10.00");
    else {
      expect(figure(top, "Value now").textContent).toMatch(/\$[\d.]+/);
      expect(figure(top, "Most it pays").textContent).toBe("$20.00");
      expect(screen.getByText("Derive's entry fees are not available yet. These positions are left out of the combined settlement figures.")).toBeTruthy();
      expect(screen.queryByRole("region", { name: /^At settlement/ })).toBeNull();
    }
    const details = card.querySelector(".q-entry");
    expect(figure(details, "Premium, before fees").textContent).toBe("$0.95");
    expect(figure(details, "Derive's fees").textContent).toMatch(/Not available yet/);
    expect(figure(details, "Total cost").textContent).toMatch(/Not available yet/);
    expect(figure(details, "Breakeven at settlement").textContent).toMatch(/Not available yet/);
    expect(details.textContent).not.toMatch(/Not entered|not entered/);
    await userEvent.setup().click(within(top).getByRole("button", { name: "Why no entry cost" }));
    expect(screen.getByText("Derive's entry fees are not available yet. Total cost and profit or loss need those fees.")).toBeTruthy();
    if (kind !== "settled") {
      await finishRead(0, rows());
      expect(figure(top, "You paid").textContent).toBe("$1.60");
      expect(figure(top, "Profit / loss now").textContent).toMatch(/\$[\d.]+/);
      expect(screen.queryByText("Derive's entry fees are not available yet. These positions are left out of the combined settlement figures.")).toBeNull();
      expect(screen.getByRole("region", { name: /^At settlement/ })).toBeTruthy();
    } else {
      await finishRead(0, unknownRows());
      expect(mock.settlements).toHaveLength(1);
      await act(async () => mock.settlements[0].resolve(91_000));
      expect(figure(top, "Got").textContent).toBe("$10.00");
      expect(figure(top, "Realized P/L").textContent).toMatch(/Not available yet/);
      const result = card.querySelector(".q-real");
      expect(figure(result, "Entry fees").textContent).toMatch(/Not available yet/);
      expect(result.textContent).toMatch(/Derive's entry fees are not available yet/);
      expect(result.textContent).not.toMatch(/Not entered|not entered|Entered by you/);
    }
  });

  it.each(["buy", "sell"])("labels a filled %s receipt's known premium before fees instead of claiming a fee-inclusive amount", async (direction) => {
    const buy = direction === "buy";
    const plan = { ...sellPlan({ position: record() }), direction, aboutLose: 1.5 };
    page(<TradeTicket plan={plan} />);
    await userEvent.setup().click(screen.getByRole("button", { name: buy ? "Get price" : "Get sell-back price" }));
    const unknown = fillFromTrades(unknownRows().map((t) => ({ ...t, direction: buy ? t.direction : t.direction === "buy" ? "sell" : "buy" })));
    act(() => mock.rfqs[0].params.onChange({ phase: "filled", fill: { ...unknown, complete: true } }));
    expect(screen.getByRole("status").textContent).toMatch(buy
      ? /Premium paid before Derive fees: \$0.95.*Total cost stays unknown/
      : /Premium received before Derive fees: \$0.95.*Proceeds after fees stay unknown/);
    expect(screen.getByRole("status").textContent).not.toMatch(/Got/);
    expect(screen.getByRole("status").textContent).not.toMatch(/contracts for/);
  });
});

describe("a buy the Derive account cannot pay for", () => {
  it("is never sent: the ticket names the balance and asks for a smaller amount", () => {
    _setSeatState({ ...seat(A, 8101), saloon: { id: 8101, usdc: 10 } });
    const plan = { ...sellPlan({ position: record() }), direction: "buy", aboutLose: 10.4 };
    page(<TradeTicket plan={plan} />);
    expect(screen.queryByRole("button", { name: "Get price" })).toBeNull();
    expect(document.body.textContent).toMatch(/Your Derive account holds \$10\.00; this costs about \$10\.40 with fees\. Choose a smaller amount\./);
    expect(mock.rfqs).toHaveLength(0);
  });

  it("says so plainly when Derive marks the quote short of funds, with Derive's words in the details", async () => {
    const plan = { ...sellPlan({ position: record() }), direction: "buy", aboutLose: 1.5 };
    page(<TradeTicket plan={plan} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Get price" }));
    act(() => mock.rfqs[0].params.onChange({ phase: "blocked", check: { ok: false, reason: "invalid", detail: "Insufficient buying power" },
      detail: { step: "price", source: "Derive", code: "quote_not_valid", message: "Insufficient buying power", data: "" } }));
    expect(document.body.textContent).toMatch(/Your Derive account doesn't hold enough for this\. Try a smaller amount\./);
    await userEvent.setup().click(screen.getByRole("button", { name: "Details for testing" }));
    expect(document.body.textContent).toContain("Insufficient buying power");
  });
});
