import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SaloonDemo from "./components/SaloonDemo.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("illustrative Saloon lesson", () => {
  it("leaves direction to the visitor and reads no market data", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<SaloonDemo />);
    expect(screen.getByRole("button", { name: "Higher" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Lower" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("slider").disabled).toBe(true);
    expect(container.textContent).not.toMatch(/\$\s?\d|\d\s?%/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("teaches partial payout and cost recovery, then reverses the curve for Lower", () => {
    render(<SaloonDemo />);
    const slider = screen.getByRole("slider", { name: "Price at settlement" });
    fireEvent.click(screen.getByRole("button", { name: "Higher" }));
    expect(slider.disabled).toBe(false);
    expect(slider.getAttribute("aria-valuetext")).toContain("Partial payout. More back than you paid");
    expect(screen.getByRole("status").classList.contains("sd-result-up")).toBe(true);
    fireEvent.change(slider, { target: { value: "46.4" } });
    expect(slider.getAttribute("aria-valuetext")).toContain("Entry cost recovered");
    expect(screen.getByRole("status").classList.contains("sd-result-neutral")).toBe(true);
    fireEvent.change(slider, { target: { value: "40" } });
    expect(slider.getAttribute("aria-valuetext")).toContain("Partial payout. Less back than you paid");
    expect(screen.getByRole("status").classList.contains("sd-result-down")).toBe(true);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByRole("status").textContent).toContain("No payoutLoss: full entry cost");
    fireEvent.change(slider, { target: { value: "100" } });
    expect(screen.getByRole("status").textContent).toContain("Full payoutMore back than you paid");

    fireEvent.click(screen.getByRole("button", { name: "Lower" }));
    expect(slider.value).toBe("50");
    expect(screen.getByRole("button", { name: "Higher" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByRole("status").textContent).toContain("Full payoutMore back than you paid");
    fireEvent.change(slider, { target: { value: "100" } });
    expect(screen.getByRole("status").textContent).toContain("No payoutLoss: full entry cost");
  });

  it("explains the complete-package settlement assumption and the difference between payout and profit", () => {
    render(<SaloonDemo />);
    fireEvent.click(screen.getByRole("button", { name: "How this payout illustration works" }));
    const detail = screen.getByRole("dialog").textContent;
    expect(detail).toContain("both options of the debit package are filled and held to settlement");
    expect(detail).toContain("including fees");
    expect(detail).toContain("Selling back early");
    expect(detail).not.toMatch(/\b(will|expect\w*|likely|predict\w*|target\w*|probabilit\w*|odds|forecast\w*)\b/i);
  });
});
