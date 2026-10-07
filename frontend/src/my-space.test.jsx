import React, { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { _resetMemory as resetPositions, loadPositions, savePositions } from "./lib/positions.js";
import { _resetMemory as resetFollows, follow, followsPersistent, loadDoc } from "./lib/follows.js";
import { exportMySpace, previewMySpace, restoreMySpace, savedCounts } from "./lib/mySpaceBackup.js";
import MySpaceBackup from "./components/MySpaceBackup.jsx";
import { FollowButton } from "./components/Follow.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";
import { returnFacts } from "./components/PositionsReturn.jsx";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, MAINNET_FILLS: true, ONE_TAP_FILLS: true, TESTNET_FILLS: false, TRADE_ON: true }));
vi.mock("./lib/pilot.js", () => ({ oneTapOffered: () => true }));
vi.mock("./lib/data.js", () => ({ useData: () => ({ data: null, error: null }) }));
vi.mock("./components/trade/TradePanel.jsx", () => ({ default: () => null, AlsoOnDerive: () => null,
  DeriveSync: function FakeSync({ onScope }) { useEffect(() => { onScope({ wallet: null }); }, []); return <p>Connect wallet to check Derive</p>; } }));
vi.mock("./pages/Board.jsx", () => ({ default: () => <p>Followed outcomes</p> }));

const ID = "BTC-20261009-A-83000-89000";
const now = 1791036000;
const position = (extra = {}) => ({ key: "saved", id: ID, side: "yes", und: "BTC", lo: 83000, hi: 89000, contracts: 0.02, paid: 100, settle_ts: 1791532800, ...extra });
const show = (node, path = "/saloon/mine") => render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
const fileOf = (text) => { const file = new File([text], "backup.json", { type: "application/json" }); file.text = async () => text; return file; };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); localStorage.clear(); resetPositions(); resetFollows(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); resetPositions(); resetFollows(); });

describe("My space recovery", () => {
  it("offers backup when only the other network has records", () => {
    savePositions([position({ network: "testnet" })], "testnet");
    show(<MyQuestions />);
    expect(screen.getByRole("button", { name: "Download backup" }).disabled).toBe(false);
    expect(screen.getByRole("heading", { name: "No positions saved here" })).toBeTruthy();
  });
  it("previews all networks and follows before writing and restores idempotently", async () => {
    savePositions([position({ network: "mainnet" })]);
    savePositions([position({ key: "test", network: "testnet" })], "testnet");
    follow(ID, "yes");
    const text = exportMySpace();
    localStorage.clear(); resetPositions(); resetFollows();
    const user = userEvent.setup({ advanceTimers: () => {} });
    show(<MySpaceBackup />);
    await user.upload(screen.getByLabelText("Restore a My space file"), fileOf(text));
    const preview = screen.getByRole("region", { name: "Restore preview" });
    expect(preview.textContent).toContain("1 mainnet records · 1 testnet records · 1 follows");
    expect(savedCounts()).toEqual({ mainnet: 0, testnet: 0, following: 0 });
    await user.click(within(preview).getByRole("button", { name: "Restore records" }));
    expect(savedCounts()).toEqual({ mainnet: 1, testnet: 1, following: 1 });
    expect(screen.getByRole("status").textContent).toContain("3 added");
    expect(restoreMySpace(previewMySpace(text))).toEqual({ mainnet: 0, testnet: 0, following: 0 });
  });
  it("validates both sections before restoring and accepts old Positions and Following exports", () => {
    const invalid = JSON.stringify({ kind: "cowboy-my-space", version: 1, positions: { positions: [position()] }, following: { anything: true } });
    expect(() => previewMySpace(invalid)).toThrow();
    expect(loadPositions()).toEqual([]);
    const older = previewMySpace(JSON.stringify({ version: 1, positions: [position()] }));
    expect(older.counts).toEqual({ mainnet: 1, testnet: 0, following: 0 });
    const following = previewMySpace(JSON.stringify({ kind: "cowboy-follows", version: 1, follows: [{ id: ID, side: "no" }] }));
    expect(following.counts.following).toBe(1);
    expect(previewMySpace(JSON.stringify([{ id: ID, side: "yes" }])).counts.following).toBe(1);
  });
});

describe("Following durability", () => {
  it("keeps a new follow beside an older stored one after a failed write and explains the session fallback", async () => {
    follow(ID, "yes");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) { if (key === "cowboy-follows") throw new DOMException("Quota", "QuotaExceededError"); return original.call(this, key, value); });
    const user = userEvent.setup({ advanceTimers: () => {} });
    show(<FollowButton id={ID} side="no" k={86000} />);
    await user.click(screen.getByRole("button", { name: "Follow Lower · $86,000" }));
    expect(loadDoc().follows.map((f) => f.side)).toEqual(["yes", "no"]);
    expect(followsPersistent()).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("This visit only");
    expect(screen.getByRole("button", { name: "Following Lower · $86,000 for this visit; stop following" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Positions confidence and return", () => {
  it("does not label unknown realized results as zero in the hero", async () => {
    savePositions([position({ paid: null, closed_at: now - 100, proceeds: 110 })]);
    const { container } = show(<MyQuestions />, "/saloon/mine?tab=closed");
    const hero = container.querySelector(".q-pnl");
    expect(within(hero).getByText("Known P&L")).toBeTruthy();
    expect(hero.querySelector(".q-pnl-total>b").textContent).toBe("Not available yet");
    expect(hero.querySelector(".q-realized-sum dd").textContent).toBe("Not available yet");
    expect(hero.textContent).toContain("0 of 1 results known");
  });
  it("identifies unresolved receipts and next settlement from records without sending orders", () => {
    const pending = position({ key: "pending", exec: "rfq", journal: { fill: { complete: false } } });
    const facts = returnFacts([pending, position({ key: "closed", closed_at: now - 100, proceeds: 90, exits: [{ kind: "close", qty: 0.02, net: 90 }] })], now);
    expect(facts.next.key).toBe("pending");
    expect(facts.unresolved.map((p) => p.key)).toEqual(["pending"]);
  });
});
