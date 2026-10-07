import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SaloonDemo from "./components/SaloonDemo.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const FORBIDDEN = /\b(will|expect\w*|likely|predict\w*|target\w*|probab\w*|odds|chance\w*|forecast\w*|bet(s|ting)?|edges?|guarantee\w*)\b|%/i;
const openSettlement = () => fireEvent.click(screen.getByText("Try a settlement price"));

describe("illustrative Saloon bubble discovery", () => {
  it("explains multiple outcomes, a selected answer and conditional returns without market or wallet reads", () => {
    const fetch = vi.fn(), websocket = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", websocket);
    const { container } = render(<SaloonDemo />);
    expect(screen.getByText("Illustration")).toBeTruthy();
    const chart = screen.getByRole("group", { name: "BTC illustrative outcomes by level and date" });
    expect(within(chart).getAllByRole("button")).toHaveLength(6);
    expect(within(chart).getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "BTC higher or lower than $85,000?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Higher" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".sd-return").textContent).toContain("Most you can make+$77.25If BTC settles at or above $88,000");
    expect(container.querySelector(".sd-figs").textContent).toContain("You pay, fees included$99.99");
    expect(container.querySelector(".sd-figs").textContent).toContain("Most it pays back$177.24");
    expect(container.querySelector(".sd-risk").textContent).toContain("Max loss $99.99");
    expect(screen.getByText("Pays in part between $82,000 and $88,000.")).toBeTruthy();
    expect(container.querySelector(".sd-settlement").open).toBe(false);
    expect(container.querySelector(".sd-payoff")).toBeNull();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(fetch).not.toHaveBeenCalled();
    expect(websocket).not.toHaveBeenCalled();
  });

  it("changes coin, date, price level and side together when a visitor selects a bubble", async () => {
    const user = userEvent.setup();
    const { container } = render(<SaloonDemo />);
    const next = screen.getByRole("button", { name: /^BTC Higher, \$88,000, Next Friday,/ });
    next.focus();
    await user.keyboard("{Enter}");
    expect(next.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "BTC higher or lower than $88,000?" })).toBeTruthy();
    expect(screen.getByText("Next Friday · 08:00 UTC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lower" }));
    expect(screen.getByRole("button", { name: /^BTC Lower, \$88,000, Next Friday,/ }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".sd-return").textContent).toContain("If BTC settles at or below $85,000");
    fireEvent.click(screen.getByRole("button", { name: "ETH Ethereum" }));
    expect(screen.getByRole("group", { name: "ETH illustrative outcomes by level and date" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ETH higher or lower than $3,500?" })).toBeTruthy();
    expect(screen.getByText("Friday · 08:00 UTC")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Higher" }).getAttribute("aria-pressed")).toBe("true");
    openSettlement();
    expect(screen.getByRole("slider").value).toBe("3570");
    expect(container.querySelector(".sd-card").textContent).not.toMatch(/BTC|\$85,000/);
  });

  it("shows fee-inclusive partial payout, zero payout, full payout and a mirrored Lower outcome", () => {
    const { container } = render(<SaloonDemo />);
    openSettlement();
    const slider = screen.getByRole("slider"), status = () => screen.getByRole("status").textContent;
    expect(status()).toContain("If BTC settles at $87,000: you get $147.70+$47.71");
    fireEvent.change(slider, { target: { value: "80000" } });
    expect(status()).toContain("you get $0.00-$99.99");
    expect(status()).toContain("Pays nothing");
    fireEvent.change(slider, { target: { value: "90000" } });
    expect(status()).toContain("you get $177.24+$77.25");
    expect(status()).toContain("Pays in full");
    fireEvent.click(screen.getByRole("button", { name: "Lower" }));
    expect(slider.value).toBe("83000");
    fireEvent.change(slider, { target: { value: "81000" } });
    expect(status()).toContain("Pays in full");
    fireEvent.change(slider, { target: { value: "89000" } });
    expect(status()).toContain("you get $0.00");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\$89,000: you get \$0\.00, -\$99\.9\d$/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it("explains rounding, settlement, partial loss and the complete-package assumption", () => {
    render(<SaloonDemo />);
    fireEvent.click(screen.getByRole("button", { name: "How this payout illustration works" }));
    const detail = screen.getByRole("dialog").textContent;
    expect(detail).toContain("both options of the debit package are filled and held to settlement");
    expect(detail).toContain("including fees");
    expect(detail).toContain("A partial payout can still be a loss.");
    expect(detail).toContain("Selling back early");
    expect(detail).not.toMatch(FORBIDDEN);
  });
});
