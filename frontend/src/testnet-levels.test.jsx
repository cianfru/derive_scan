// Testnet builds: the board comes from mainnet chains, and Derive's testnet lists other strikes. A
// level the testnet does not list reads "Not on testnet" on the board and the outcome panel, and its
// ticket says so plainly instead of "No price"; there is no way to place it by hand.
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/flags.js", () => ({ FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, MAINNET_FILLS: false, ONE_TAP_FILLS: true, tradeMode: () => "testnet" }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Board from "./pages/Board.jsx";
import Questions from "./pages/Questions.jsx";
import { _resetMemory } from "./lib/positions.js";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { createClient } from "./lib/trade/derive.js";
import { fakeDerive, deriveError } from "./lib/trade/fakeSocket.js";
import { TESTNET_WS } from "./lib/trade/config.js";
import { _resetListing, listedInstruments, testnetListing } from "./lib/trade/listing.js";
import { missingLegs } from "./lib/testnetLevels.js";

const T14 = 1791036000;
const H = "BTC-20261005-A-82000-88000";
const C88 = "BTC-20261005-88000-C";
let fake;

/** Every option the fixture's BTC board uses, less `drop`, as the testnet would list them. */
function listing(drop = []) {
  const names = new Set();
  for (const d of btc.dates) for (const l of d.levels) {
    for (const side of ["yes", "no"]) for (const n of missingLegs(l.id, side, new Set())) names.add(n);
  }
  return [...names].filter((n) => !drop.includes(n)).map((instrument_name) => ({ instrument_name, instrument_type: "option" }));
}

function setup(handler) {
  _resetListing();
  fake = fakeDerive({ handlers: { "public/get_all_instruments": handler } });
  _setSeatDeps({ findProvider: () => null, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {}, retries: 0 }) });
}

const show = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/saloon" element={<Board />} />
      <Route path="/q/:id" element={<Questions />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  localStorage.clear();
  _resetMemory();
  docs.current = { "questions/index.json": { ...index, coins: index.coins.filter((c) => c.und === "BTC") }, "questions/BTC.json": btc, "markets.json": { coins: [] } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the helper", () => {
  it("names the options a level needs that the list lacks, and blocks nothing without a list", () => {
    const listed = new Set(["BTC-20261005-82000-C", "BTC-20261005-82000-P", "BTC-20261005-88000-P"]);
    expect(missingLegs(H, "yes", listed)).toEqual([C88]);
    expect(missingLegs(H, "no", listed)).toEqual([]);
    expect(missingLegs(H, "yes", null)).toEqual([]);
    expect(missingLegs("nonsense", "yes", listed)).toEqual([]);
    expect(missingLegs("XRP-20261005-A-1_35-1_45", "yes", new Set(["XRP-20261005-1_35-C"]))).toEqual(["XRP-20261005-1_45-C"]);
  });

  it("reads every page of the instrument list once per coin, and a failed read blocks nothing", async () => {
    const pages = { 1: [{ instrument_name: "BTC-20261005-82000-C" }], 2: [{ instrument_name: C88 }] };
    setup((p) => ({ instruments: pages[p.page], pagination: { num_pages: 2, count: 2 } }));
    const s = await testnetListing("BTC");
    expect([...s]).toEqual(["BTC-20261005-82000-C", C88]);
    expect(fake.calls("public/get_all_instruments").map((c) => c.params)).toEqual([
      { currency: "BTC", instrument_type: "option", expired: false, page: 1, page_size: 1000 },
      { currency: "BTC", instrument_type: "option", expired: false, page: 2, page_size: 1000 },
    ]);
    await testnetListing("BTC");
    expect(fake.calls("public/get_all_instruments")).toHaveLength(2);
    expect(await testnetListing("not a coin")).toBeNull(); // every board coin is read (one tap for all coins); only a non-coin is not
    setup(deriveError(9002, "backend unavailable"));
    expect(await testnetListing("ETH")).toBeNull();
    const client = createClient({ url: TESTNET_WS, WebSocketImpl: fakeDerive({ handlers: { "public/get_all_instruments": { instruments: [], pagination: { num_pages: 1 } } } }).WebSocketImpl });
    expect((await listedInstruments(client, "ETH")).size).toBe(0);
  });
});

// The trade chunk loads lazily and the listing comes from a simulated socket: under a full parallel
// run that can take longer than the default one second.
const LOAD = { timeout: 5000 };

describe("a level the testnet does not list", () => {
  it("reads Not on testnet on the board, and the other answer stays open", async () => {
    setup({ instruments: listing([C88]), pagination: { num_pages: 1 } });
    show("/saloon");
    const off = await screen.findAllByText("Not on testnet", {}, LOAD);
    expect(off).toHaveLength(1);
    const card = off[0].closest(".bd-card");
    expect(within(card).queryByRole("link", { name: /Higher than \$85,000 on .*: see what it pays/ })).toBeNull();
    expect(within(card).getByRole("link", { name: /Lower than \$85,000 on .*: see what it pays/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /is not on testnet/ })).toBeTruthy();
  });

  it("says so in the outcome panel and the ticket", async () => {
    setup({ instruments: listing([C88]), pagination: { num_pages: 1 } });
    const user = userEvent.setup();
    show(`/q/${H}?side=yes`);
    await screen.findByText("Not on testnet", {}, LOAD);
    await user.click(screen.getByRole("button", { name: "Review trade" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" }, LOAD);
    await within(panel).findByText("Derive's testnet doesn't list this level. Pick another level.", {}, LOAD);
    expect(within(panel).queryByRole("button", { name: "Connect wallet" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Try again|Get price/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Place by hand" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Details for testing" }));
    expect(document.body.textContent).toContain(C88);
  });

  it("blocks nothing when the list cannot be read", async () => {
    setup(deriveError(9002, "backend unavailable"));
    const user = userEvent.setup();
    show(`/q/${H}?side=yes`);
    await waitFor(() => expect(fake.calls("public/get_all_instruments").length).toBeGreaterThan(0));
    expect(screen.queryByText("Not on testnet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review trade" }));
    const panel = await screen.findByRole("region", { name: "Higher through Derive" });
    expect(within(panel).getByText("One tap needs a browser wallet.")).toBeTruthy();
    expect(within(panel).queryByText(/doesn't list this level/)).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Place by hand" })).toBeNull();
  });
});
