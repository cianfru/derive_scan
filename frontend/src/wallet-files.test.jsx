import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useData } from "./lib/data.js";
import Trader, { NoProfile, lastActive } from "./pages/Trader.jsx";
import CoinWallets from "./components/CoinWallets.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const INDEX = { through: "2026-10-02", fields: ["address", "books", "last_offset_days", "has_file"],
  wallets: [["0xabc0000000000000000000000000000000000001", "o", 12, 0]] };

function serve(files) {
  vi.stubGlobal("fetch", vi.fn((url) => {
    const hit = Object.entries(files).find(([path]) => String(url).endsWith(path));
    return Promise.resolve(hit ? { ok: true, status: 200, json: async () => hit[1] } : { ok: false, status: 404, json: async () => ({}) });
  }));
}

describe("wallet files that do not exist", () => {
  it("useData reports missing on a 404", async () => {
    serve({});
    const { result } = renderHook(() => useData("traders/0xnone-a.json"));
    await waitFor(() => expect(result.current.missing).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("the trader fallback shows the last active day from the index, or no profile", () => {
    expect(lastActive(INDEX, "0xABC0000000000000000000000000000000000001")).toBe("2026-09-20");
    render(<MemoryRouter><NoProfile address="0xabc0000000000000000000000000000000000001" index={INDEX} /></MemoryRouter>);
    expect(screen.getByText("Not on the leaderboard · last active 2026-09-20")).toBeTruthy();
    cleanup();
    render(<MemoryRouter><NoProfile address="0xdef0000000000000000000000000000000000002" index={INDEX} /></MemoryRouter>);
    expect(screen.getByText("No public profile for this wallet.")).toBeTruthy();
  });

  it("the trader page reads the index after a 404 instead of spinning", async () => {
    serve({ "traders/index.json": INDEX });
    render(<MemoryRouter initialEntries={["/trader/0xabc0000000000000000000000000000000000001"]}>
      <Routes><Route path="/trader/:address" element={<Trader />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Not on the leaderboard · last active 2026-09-20")).toBeTruthy());
  });

  it("CoinWallets shows its empty state on a 404", async () => {
    serve({});
    render(<MemoryRouter><CoinWallets und="ZZZ404" alignment={null} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("No ranked trader holds options on this coin right now.")).toBeTruthy());
    expect(screen.queryByLabelText("Loading")).toBeNull();
  });
});
