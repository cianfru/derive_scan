import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SaloonDemo from "./components/SaloonDemo.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const FORBIDDEN = /\b(will|expect\w*|likely|predict\w*|target\w*|probab\w*|odds|chance\w*|forecast\w*|bet(s|ting)?|edges?|guarantee\w*)\b|%/i;

describe("illustrative Saloon example", () => {
  it("shows one plainly labelled example answer, leaves the pick to the visitor and reads no market data", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<SaloonDemo />);
    expect(screen.getByText("Illustration")).not.toBeNull();
    expect(screen.getByText("Example: pick Higher or Lower")).not.toBeNull();
    expect(container.textContent).toContain("BTC higher or lower than $85,000 on a Friday, 08:00 UTC?");
    const higher = screen.getByRole("button", { name: "Higher" });
    const lower = screen.getByRole("button", { name: "Lower" });
    expect(higher.getAttribute("aria-pressed")).toBe("false");
    expect(lower.getAttribute("aria-pressed")).toBe("false");
    expect(higher.textContent).toContain("55¢");
    expect(lower.textContent).toContain("48¢");
    expect(screen.getByRole("slider").disabled).toBe(true);
    expect(container.querySelector(".sd-payoff")).toBeNull();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prices $100 including fees with the Saloon's maths and reads the payout and P/L at a settlement price", () => {
    const { container } = render(<SaloonDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Higher" }));
    const slider = screen.getByRole("slider");
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe("87000");
    const figs = container.querySelector(".sd-figs").textContent;
    expect(figs).toMatch(/You put in\$99\.9\d/);
    expect(figs).toContain("Most it pays$177.24");
    const status = () => screen.getByRole("status").textContent;
    expect(status()).toContain("If BTC settles at $87,000: you get $147.70");
    expect(status()).toContain("+$47.71");
    expect(screen.getByRole("status").classList.contains("sd-result-up")).toBe(true);
    fireEvent.change(slider, { target: { value: "80000" } });
    expect(status()).toContain("you get $0.00");
    expect(status()).toContain("Pays nothing");
    expect(screen.getByRole("status").classList.contains("sd-result-down")).toBe(true);
    fireEvent.change(slider, { target: { value: "90000" } });
    expect(status()).toContain("you get $177.24");
    expect(status()).toContain("Pays in full");
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it("mirrors the payout for Lower", () => {
    render(<SaloonDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Higher" }));
    fireEvent.click(screen.getByRole("button", { name: "Lower" }));
    expect(screen.getByRole("button", { name: "Higher" }).getAttribute("aria-pressed")).toBe("false");
    const slider = screen.getByRole("slider");
    expect(slider.value).toBe("83000");
    fireEvent.change(slider, { target: { value: "81000" } });
    expect(screen.getByRole("status").textContent).toContain("Pays in full");
    fireEvent.change(slider, { target: { value: "89000" } });
    expect(screen.getByRole("status").textContent).toContain("you get $0.00");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\$89,000: you get \$0\.00, -\$99\.9\d$/);
  });

  it("explains the complete-package settlement assumption and the difference between payout and profit", () => {
    render(<SaloonDemo />);
    fireEvent.click(screen.getByRole("button", { name: "How this payout illustration works" }));
    const detail = screen.getByRole("dialog").textContent;
    expect(detail).toContain("both options of the debit package are filled and held to settlement");
    expect(detail).toContain("including fees");
    expect(detail).toContain("Selling back early");
    expect(detail).not.toMatch(FORBIDDEN);
  });
});
