import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RyskMock from "./components/RyskMock.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const forbidden = /\b(will|expect\w*|likely|predict\w*|target\w*|probab\w*|odds|forecast\w*|guarantee\w*)\b/i;

describe("Rysk discussion illustration", () => {
  it("puts collateral and conversion obligations before premium, without reading or trading", () => {
    const fetch = vi.fn(), websocket = vi.fn();
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("WebSocket", websocket);
    const { container } = render(<RyskMock und="BTC" />);
    const text = container.textContent;
    expect(text.indexOf("You lock until settlement")).toBeLessThan(text.indexOf("Example premium"));
    expect(text).toContain("0.01 BTC");
    expect(text).toContain("Example term: 7 days from locking the collateral.");
    expect(text).toContain("Above $90,000 at settlement, you sell 0.01 BTC for $900.00.");
    expect(text).toContain("Physical settlement · No early exit");
    expect(text).toContain("The premium can be smaller than the loss.");
    expect(text).toContain("Fees not modelled");
    expect(text).toContain("not a quote or coin listing");
    expect(text).not.toMatch(forbidden);
    expect(fetch).not.toHaveBeenCalled(); expect(websocket).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /connect|trade|approve|fund|buy now/i })).toBeNull();
  });

  it("shows covered-call collateral loss and capped gains without calling premium profit", () => {
    render(<RyskMock und="BTC" />);
    const examples = screen.getAllByRole("listitem");
    expect(examples).toHaveLength(3);
    expect(examples[0].textContent).toContain("BTC at $68,000-$146.00");
    expect(examples[0].textContent).toContain("Collateral returned: 0.01 BTC");
    expect(examples[0].textContent).toContain("Holdings worth $680.00 + $24.00 premium.");
    expect(examples[1].textContent).toContain("BTC at $85,000+$24.00");
    expect(examples[2].textContent).toContain("BTC at $108,000+$74.00");
    expect(examples[2].textContent).toContain("Coin sold: $900.00");
    expect(examples[2].textContent).toContain("Holdings worth $900.00 + $24.00 premium.");
  });

  it("keeps a put's purchase obligation and market-value loss explicit", () => {
    const { container } = render(<RyskMock und="BTC" />);
    fireEvent.click(screen.getByRole("tab", { name: "Buy at a level" }));
    expect(screen.getByRole("tab", { name: "Buy at a level" }).getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Below $80,000 at settlement, you buy 0.01 BTC for $800.00.");
    const examples = screen.getAllByRole("listitem");
    expect(examples[0].textContent).toContain("BTC at $48,000-$298.00");
    expect(examples[0].textContent).toContain("Coin bought: 0.01 BTC");
    expect(examples[1].textContent).toContain("BTC at $76,000-$18.00");
    expect(examples[2].textContent).toContain("BTC at $102,000+$22.00");
    expect(examples[2].textContent).toContain("Collateral returned: $800.00");
    expect(container.textContent).not.toMatch(forbidden);
  });

  it("supports keyboard choice and explains the price, fee and settlement assumptions on demand", async () => {
    const user = userEvent.setup();
    render(<RyskMock und="ETH" />);
    const call = screen.getByRole("tab", { name: "Sell at a level" });
    call.focus(); await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Buy at a level" }));
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("ETH at $1,800-$1,130.00");
    fireEvent.click(screen.getByRole("button", { name: "About the example premium" }));
    expect(screen.getByRole("dialog").textContent).toContain("It is not the overall profit");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About the Rysk obligation" }));
    expect(screen.getByRole("dialog").textContent).toContain("need confirmation with Rysk");
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /trade/i })).toBeNull();
  });

  it("keeps unlisted and malformed tickers illustrative rather than suggesting availability", () => {
    const { container, rerender } = render(<RyskMock und="ZEC" />);
    expect(container.textContent).toContain("1 ZEC");
    expect(container.textContent).toContain("not a quote or coin listing");
    rerender(<RyskMock und="<bad>" />);
    expect(container.textContent).toContain("10 HYPE");
    expect(container.textContent).not.toContain("<bad>");
  });
});
