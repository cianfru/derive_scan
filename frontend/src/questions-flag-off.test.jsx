import React from "react";
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import { QUESTIONS_ON } from "./lib/flags.js";

it("keeps Questions out of the nav unless the build switches them on", () => {
  expect(QUESTIONS_ON).toBe(false);
  render(<MemoryRouter><Routes><Route element={<Shell />}><Route index element={<p>home</p>} /></Route></Routes></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Markets" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Questions" })).toBeNull();
});
