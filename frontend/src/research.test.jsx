import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { comparisonView, moveScale, expiryEvidence } from "./lib/research.js";
import OptionsWorkspace from "./components/OptionsWorkspace.jsx";
vi.mock("./lib/useElementWidth.js", () => ({
  useElementWidth: () => [null, 640],
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("withholds agreement when either engine expires or is unavailable", () => {
  const c = {
    "4h": { status: "ready", observed_at: 100000, timeframe: "4h" },
    "1d": { status: "ready", observed_at: 100000, timeframe: "1d" },
    confluence: { score: 100 },
    unified: "LIGHT_LONG",
  };
  expect(comparisonView(c, 100100).unified).toBe("LIGHT_LONG");
  expect(comparisonView(c, 116000).unified).toBeNull();
  expect(
    comparisonView({ ...c, "4h": { ...c["4h"], status: "warming up" } }, 100100)
      .confluence,
  ).toBeNull();
  expect(comparisonView(c, 99999).complete).toBe(false);
});
it("does not manufacture a movement scale from missing or invalid quotes", () => {
  expect(moveScale(100, 0.2, 365)).toEqual({
    move: 20,
    fraction: 0.2,
    lower: 80,
    upper: 120,
  });
  for (const iv of [null, undefined, NaN, -0.2, 0])
    expect(moveScale(100, iv)).toBeNull();
  expect(moveScale(0, 0.2)).toBeNull();
});
const a = 1793347200,
  b = 1795766400;
const opts = {
  ts: 1790968500,
  status: "ready",
  chain_status: "ready",
  chain_at: 1790968500,
  features: { index_price: 100, atm_iv_30d: 0.3 },
  expiries: [
    {
      expiry: a,
      tenor_days: 27,
      atm_iv: 0.3,
      forward: 101,
      call_oi: 10,
      put_oi: 20,
    },
    {
      expiry: b,
      tenor_days: 55,
      atm_iv: 0.4,
      forward: 103,
      call_oi: 30,
      put_oi: 40,
    },
  ],
  strikes: {
    expiries: {
      [a]: [[90, 10, 20, 0.32, 0.33]],
      [b]: [[110, 30, 40, 0.4, 0.41]],
    },
  },
  implied: [
    { expiry: a, q: [80, 85, 100, 115, 120], method: "atm" },
    { expiry: b, q: [60, 70, 103, 140, 150], method: "smile" },
  ],
};
it("links selected expiry evidence by date rather than array order", () => {
  const v = expiryEvidence(opts, b);
  expect(v.call[0]).toBe(110);
  expect(v.implied.q[1]).toBe(70);
  expect(v.expiry.forward).toBe(103);
  expect(expiryEvidence(opts, 0).implied).toBeUndefined();
});
it("changing expiry updates the forward, concentration and range together", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  render(<OptionsWorkspace opts={opts} und="BTC" />);
  expect(screen.getByText("$101.00")).toBeTruthy();
  expect(screen.getByText("$85.00 — $115.00")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /11-27/ }));
  expect(screen.getByText("$103.00")).toBeTruthy();
  expect(screen.getByText("$70.00 — $140.00")).toBeTruthy();
  expect(screen.getAllByText("$110").length).toBeGreaterThan(0);
  expect(screen.queryByText("$85.00 — $115.00")).toBeNull();
});
