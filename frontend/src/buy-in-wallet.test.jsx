import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BuyInWallet, { WALLET_BUY_GUIDES } from "./components/trade/BuyInWallet.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: /No crypto yet\?/ }));
const announce = (provider, rdns, name = "Wallet") => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider, info: { rdns, name } } }));

describe("buying in a wallet", () => {
  it("offers three short, optional steps and leaves purchases and network reads outside Cowboy", () => {
    const provider = { request: vi.fn() }, fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<BuyInWallet provider={provider} />);
    expect(screen.queryByRole("region")).toBeNull();
    open();
    const panel = screen.getByRole("region", { name: "Buy in your wallet" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(panel.textContent).toContain("Choose USDC on Ethereum.");
    expect(panel.textContent).toContain("Select Apple Pay if it is offered.");
    expect(panel.textContent).toContain("Continue funding your Derive account.");
    expect(panel.textContent).toContain("Availability depends on your wallet and location.");
    expect(within(panel).getAllByRole("link").map((a) => a.href)).toEqual(WALLET_BUY_GUIDES.map((g) => g.url));
    expect(within(panel).getAllByRole("link").every((a) => a.rel.includes("noreferrer"))).toBe(true);
    expect(provider.request).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names only an announced supported wallet matched to the connected provider", () => {
    const provider = { request: vi.fn(), isMetaMask: true };
    render(<BuyInWallet provider={provider} networkName="Base" />);
    open();
    // isMetaMask is shared by other wallets; neither it nor an unrelated announcement is enough.
    expect(screen.getByRole("heading", { name: "Buy in your wallet" })).toBeTruthy();
    fireEvent(window, new CustomEvent("eip6963:announceProvider", { detail: { provider: {}, info: { rdns: "io.metamask" } } }));
    expect(screen.getByRole("heading", { name: "Buy in your wallet" })).toBeTruthy();
    fireEvent(window, new CustomEvent("eip6963:announceProvider", { detail: { provider, info: { rdns: "io.metamask", name: "Ignored custom name" } } }));
    expect(screen.getByRole("heading", { name: "Buy in MetaMask" })).toBeTruthy();
    expect(screen.getByText("Choose USDC on Base.")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "MetaMask guide" })).toBeTruthy();
    expect(screen.queryByText("Ignored custom name")).toBeNull();
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("rechecks the active provider and keeps unfamiliar identities generic", () => {
    const provider = {}, other = {};
    const { rerender } = render(<BuyInWallet provider={provider} />);
    const responder = () => announce(provider, "com.coinbase.wallet");
    window.addEventListener("eip6963:requestProvider", responder);
    open();
    window.removeEventListener("eip6963:requestProvider", responder);
    expect(screen.getByRole("heading", { name: "Buy in Coinbase Wallet" })).toBeTruthy();
    rerender(<BuyInWallet provider={other} />);
    expect(screen.getByRole("heading", { name: "Buy in your wallet" })).toBeTruthy();
    fireEvent(window, new CustomEvent("eip6963:announceProvider", { detail: { provider: other, info: { rdns: "unconfirmed.wallet", name: "MetaMask" } } }));
    expect(screen.getByRole("heading", { name: "Buy in your wallet" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("keeps fees and identity checks in the explanation and returns focus when closing", async () => {
    const user = userEvent.setup();
    render(<BuyInWallet />);
    const trigger = screen.getByRole("button", { name: /No crypto yet\?/ });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Apple Pay fees and availability" }));
    const detail = screen.getByRole("dialog");
    expect(detail.textContent).toContain("sets the purchase fee");
    expect(detail.textContent).toContain("may ask for an identity check");
    expect(detail.textContent).toContain("moving it into Derive is a separate step");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Back to funding" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
