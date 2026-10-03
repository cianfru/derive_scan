import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true }));
import Shell from "./components/Shell.jsx";

it("shows Questions beside Markets in a build with VITE_QUESTIONS=1", () => {
  render(<MemoryRouter><Routes><Route element={<Shell />}><Route index element={<p>home</p>} /></Route></Routes></MemoryRouter>);
  const links = screen.getAllByRole("link").map((a) => a.textContent);
  expect(links.indexOf("Questions")).toBe(links.indexOf("Markets") + 1);
});
