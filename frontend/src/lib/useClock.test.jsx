import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useClock } from "./useClock.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Clock() {
  return <output data-testid="clock">{useClock()}</output>;
}

it("updates an idle page's clock and clears its timer on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const { unmount } = render(<Clock />);
  expect(screen.getByTestId("clock").textContent).toBe("100");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByTestId("clock").textContent).toBe("101");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("catches up immediately when returning to a page after background timer throttling", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  render(<Clock />);
  vi.setSystemTime(200000);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(screen.getByTestId("clock").textContent).toBe("200");
  vi.setSystemTime(300000);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(screen.getByTestId("clock").textContent).toBe("300");
});
