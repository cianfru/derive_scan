import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const docs = vi.hoisted(() => ({ current: null }));
vi.mock("./lib/data.js", () => ({ useData: () => ({ data: docs.current }) }));
vi.mock("./components/PnlHistory.jsx", () => ({ default: () => <section className="plate pnl-history"><h2>P&L history</h2><div role="slider" aria-label="P&L history" /></section> }));
import Trader from "./pages/Trader.jsx";

const address = "0xabc0000000000000000000000000000000000001";
const expiry = Date.parse("2026-10-09T08:00:00Z") / 1000;
function profile() {
  return {
    ready: true, status: "ready", address, rank: 3, tier: "smart", option_pnl: 15000, win_rate: .75,
    expired: 120, premium_traded: 89000, first: "2024-01-01", last: "2026-10-06", perp_pnl: -500,
    pnl_cohort: "Smart Money", size_cohort: "Whale", through: "2026-10-06", valued_at: expiry - 500000,
    lean: { score: 1, net_delta_usd: 10000, gross_delta_usd: 10000 },
    book: Array.from({ length: 5 }, (_, i) => ({ und: "BTC", instrument: `BTC-20261009-${80000 + i * 1000}-C`, expiry, strike: 80000 + i * 1000, net: i + 1, entry: i ? 300 : null, mark: 450, delta_usd: 2000, delta_source: i ? "quoted" : "estimated", upnl: i ? 100 : null })),
    pnl_history: [["2026-10-01", 1000, 2000]],
    large_24h: Array.from({ length: 23 }, (_, i) => ({ instrument: `BTC-20261009-${80000 + i * 1000}-C`, ts: (expiry - 100000) * 1000, direction: "buy", amount: 1, price: 100 + i, notional_usd: 80000 + i })),
    recent: Array.from({ length: 25 }, (_, i) => ["2026-10-06", `BTC-20261009-${80000 + i * 1000}-C`, 1, 0, 200 + i, 0]),
    gaps: 1, gap_days: ["2026-09-01"],
  };
}

function mediaAt(phone) {
  const listeners = new Set();
  const media = { matches: phone, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return (next) => act(() => { media.matches = next; for (const listener of listeners) listener(); });
}
function page() {
  return render(<MemoryRouter initialEntries={[`/trader/${address}`]}><Routes><Route path="/trader/:address" element={<Trader />} /></Routes></MemoryRouter>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the original desktop order, figures and twenty-trade sample", () => {
  mediaAt(false);
  docs.current = profile();
  const { container } = page();
  expect(container.querySelector(".trader-phone, .tm-fold, .tm-option")).toBeNull();
  expect([...container.querySelectorAll("h2")].map((el) => el.textContent)).toEqual(["P&L history", "Open optionsi", "Large trades, 24h", "Recent activityi"]);
  expect(container.querySelectorAll(".book-row")).toHaveLength(5);
  const large = screen.getByRole("heading", { name: "Large trades, 24h" }).closest("section");
  expect(large.querySelectorAll(".trade-row")).toHaveLength(20);
  expect(screen.getByText("Premium traded")).toBeTruthy();
});

it("puts the phone book before collapsed history while keeping every option and profile figure reachable", async () => {
  mediaAt(true);
  docs.current = profile();
  const user = userEvent.setup();
  const { container } = page();
  const folds = [...container.querySelectorAll(".trader-phone > details")];
  expect(folds.map((el) => el.firstElementChild.textContent)).toEqual(["P&L history", "Large trades, 24h · 23", "Recent activity", "Snapshot details"]);
  expect(folds.every((el) => !el.open)).toBe(true);
  expect(screen.getByRole("heading", { name: /^Open options/ }).compareDocumentPosition(folds[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelectorAll(".tm-book .tm-option")).toHaveLength(5);
  const more = screen.getByText("Show 2 more BTC options");
  expect(more.closest("details").open).toBe(false);
  await user.click(more);
  expect(more.closest("details").open).toBe(true);
  const first = container.querySelector(".tm-option");
  await user.click(first.querySelector("summary"));
  expect(first.open).toBe(true);
  expect(within(first).getByText("Entry").nextElementSibling.textContent).toBe("—");
  expect(within(first).getByText("Mark").nextElementSibling.textContent).toBe("450.00");
  expect(within(first).getByText("Delta").nextElementSibling.textContent).toBe("$2K est");
  const profileSummary = screen.getByText("Profile details");
  await user.click(profileSummary);
  const profileDetails = profileSummary.closest("details");
  expect(profileDetails.open).toBe(true);
  expect(within(profileDetails).getByText(address)).toBeTruthy();
  expect(within(profileDetails).getByText("Premium traded").nextElementSibling.textContent).toBe("$89K");
  expect(within(profileDetails).getByText("Expired options").nextElementSibling.textContent).toBe("120");
  expect(screen.getByRole("link", { name: "BTC" }).getAttribute("href")).toBe("/coin/BTC#wallets");
});

it("retains every large trade and expands the complete recent activity on phones", async () => {
  mediaAt(true);
  docs.current = profile();
  const user = userEvent.setup();
  const { container } = page();
  expect(container.querySelectorAll(".tm-large-trades > details")).toHaveLength(23);
  await user.click(screen.getByText("Large trades, 24h · 23"));
  const last = [...container.querySelectorAll(".tm-large-trades > details")].at(-1);
  await user.click(last.querySelector("summary"));
  expect(last.open).toBe(true);
  expect(within(last).getByText("Time")).toBeTruthy();
  expect(within(last).getByText("Notional").nextElementSibling.textContent).toBe("$80K");
  await user.click(screen.getByText("Recent activity", { selector: "summary" }));
  expect(container.querySelectorAll(".trade-row")).toHaveLength(20);
  await user.click(screen.getByRole("button", { name: "Show all 25" }));
  expect(container.querySelectorAll(".trade-row")).toHaveLength(25);
  await user.click(screen.getByText("Snapshot details"));
  expect(screen.getByText(/historical snapshot/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "About gaps in the wallet history" })).toBeTruthy();
});

it("restores the original desktop content after the phone breakpoint changes", () => {
  const resize = mediaAt(true);
  docs.current = profile();
  const { container } = page();
  expect(container.querySelector(".trader-phone")).toBeTruthy();
  resize(false);
  expect(container.querySelector(".trader-phone, .tm-fold")).toBeNull();
  expect([...container.querySelectorAll("h2")][0].textContent).toBe("P&L history");
  expect(container.querySelectorAll(".book-row")).toHaveLength(5);
  resize(true);
  expect(container.querySelector(".trader-phone")).toBeTruthy();
});
