import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
import Home, { CARDS } from "./pages/Home.jsx";
import { BANNED } from "./lib/questions.js";

afterEach(cleanup);
const show = () => render(
  <MemoryRouter initialEntries={["/home"]}>
    <Routes><Route path="/home" element={<Home />} /><Route path="*" element={<p>landed</p>} /></Routes>
  </MemoryRouter>,
);

describe("card home", () => {
  it("offers one card per part of Cowboy, each opening its page", () => {
    docs.current = { "questions/index.json": { coins: [{ und: "BTC", smart: 3 }, { und: "ETH", smart: 1 }] }, "markets.json": { coins: [{}, {}, {}] },
      "traders.json": { traders: [{ address: "0x" + "a".repeat(40) }, { address: "0x" + "b".repeat(40) }] } };
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where do you want to ride?");
    const links = CARDS.map((c) => screen.getByRole("link", { name: new RegExp(c.label) }).getAttribute("href"));
    expect(links).toEqual(["/saloon", "/saloon/mine", "/radar", "/traders", "/markets", "/traders/posses", "/options"]);
    expect(screen.getByText("2 coins open · 4 gold rings")).toBeTruthy();
    expect(screen.getByText("3 markets")).toBeTruthy();
    expect(document.querySelectorAll(".home-hats .wtag-av")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("opens a card large with the +, and a click on the card itself goes to its page", () => {
    docs.current = {};
    show();
    fireEvent.click(screen.getByRole("button", { name: "More about Radar" }));
    const pop = document.querySelector("dialog.home-pop");
    expect(pop.hasAttribute("open")).toBe(true);
    expect(within(pop).getByRole("link", { name: "Open the radar" }).getAttribute("href")).toBe("/radar");
    fireEvent.click(within(pop).getByRole("button", { name: "Close" }));
    expect(pop.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getAllByRole("article")[4]);
    expect(screen.getByText("landed")).toBeTruthy();
  });
});
