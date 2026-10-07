// Real-money one tap (P8), as a mainnet build renders it: a browser outside the pilot gets the ticket
// placed by hand with `oneTapComing` (QuestionTicket's note "One-tap trading is coming to Cowboy…"); a
// pilot browser gets the one-tap panel, marked "Real money", with no testnet wording or testing details.
import React from "react";
import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const PILOT = "0x4201c60c3c85e641c9837588429f59ca57e22be2";
vi.hoisted(() => {
  // The build's variables, before any module reads them.
  process.env.VITE_SALOON_TRADE = "mainnet";
  process.env.VITE_SALOON_PILOT = "0x4201c60c3c85e641c9837588429f59ca57e22be2";
  process.env.VITE_QUESTIONS = "1";
});
vi.mock("./lib/flags.js", () => ({
  FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: false, MAINNET_FILLS: true, ONE_TAP_FILLS: true, tradeMode: () => "mainnet",
}));
vi.mock("./lib/data.js", () => ({ DATA_URL: "https://example.invalid/", useData: () => ({ data: { trading: "on", trading_mainnet: "off", coins: [] }, error: null }) }));
import TradePanel from "./components/trade/TradePanel.jsx";
import { NETWORK } from "./lib/trade/config.js";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { LAST_MAINNET_WALLET, PILOT_INVITE } from "./lib/pilot.js";

function Hand({ oneTapComing }) {
  return <div data-testid="hand">{oneTapComing ? "coming" : "plain"}</div>;
}
const show = () => render(
  <MemoryRouter>
    <TradePanel und="BTC" question="BTC above $86,000?" answer="Higher" level={null} sideKey="yes" board={null} t={null} fallback={<Hand />} />
  </MemoryRouter>,
);

beforeEach(() => {
  localStorage.clear();
  _setSeatDeps({ findProvider: () => null });
});
afterEach(cleanup);
// The variables were set for this file only; later files in the same worker start without them.
afterAll(() => { for (const k of ["VITE_SALOON_TRADE", "VITE_SALOON_PILOT", "VITE_QUESTIONS"]) delete process.env[k]; });

describe("a mainnet build", () => {
  it("runs on Derive V3 mainnet", () => {
    expect(NETWORK).toMatchObject({ name: "mainnet", chainId: 1, wsUrl: "wss://api.derive.xyz/v3/ws" });
  });

  it("gives a browser outside the pilot the ticket by hand, with the coming note", () => {
    show();
    expect(screen.getByTestId("hand").textContent).toBe("coming");
    expect(screen.queryByText(/Real money/)).toBeNull();
    // A wallet off the list that connected before changes nothing.
    cleanup();
    localStorage.setItem(LAST_MAINNET_WALLET, "0x00000000000000000000000000000000000000aa");
    show();
    expect(screen.getByTestId("hand").textContent).toBe("coming");
  });

  it("gives a pilot browser the one-tap panel, marked real money, with the switch's notice", () => {
    localStorage.setItem(LAST_MAINNET_WALLET, PILOT);
    show();
    expect(screen.queryByTestId("hand")).toBeNull();
    expect(screen.getByText("Real money")).toBeTruthy();
    expect(screen.getByText(/Cowboy has paused one-tap trading/)).toBeTruthy(); // trading_mainnet is off
    expect(document.body.textContent).not.toMatch(/testnet|Testnet|test USDC|Details for testing/);
  });

  it("the pilot invitation opens the panel in this browser", () => {
    localStorage.setItem(PILOT_INVITE, "1");
    show();
    expect(screen.getByText("Real money")).toBeTruthy();
  });
});
