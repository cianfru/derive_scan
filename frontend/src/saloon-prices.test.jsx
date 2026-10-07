import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SaloonHead from "./components/SaloonNotices.jsx";

const TS = Date.UTC(2026, 9, 7, 17) / 1000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((TS + 600) * 1000);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const show = (props = {}) => render(<MemoryRouter><SaloonHead board view="chart" quoteTs={TS} {...props} /></MemoryRouter>);

it("keeps the quote timestamp and its distinction from the live index accessible on demand", () => {
  show();
  const button = screen.getByRole("button", { name: "About option quote prices" });
  fireEvent.click(button);
  const details = screen.getByRole("dialog", { name: "About option quote prices" });
  expect(details.textContent).toContain("7 Oct 2026 · 17:00 UTC");
  expect(details.textContent).toContain("live index is separate");
  expect(details.querySelector("time").dateTime).toBe("2026-10-07T17:00:00.000Z");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("surfaces stale prices as time passes without waiting for a data refresh", () => {
  show();
  act(() => { vi.advanceTimersByTime(26 * 60_000); });
  expect(screen.getByText("Stale prices")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "About option quote prices" }));
  expect(screen.getByRole("dialog").textContent).toContain("36 minutes old");
});

it.each([[{ paused: true }, "Quotes paused"], [{ quoteTs: undefined }, "Awaiting prices"]])("keeps paused or missing quote status visible: %j", (props, text) => {
  const { container } = show(props);
  expect(container.querySelector(".bd-mobile-prices").textContent).toContain(text);
});
