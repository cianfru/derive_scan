import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PosseName from "./components/PosseName.jsx";

describe("PosseName", () => {
  it("shows the Western name with an (i) that says what it means", () => {
    render(<PosseName code="Leviathan" />);
    expect(screen.getByText("Railroad Baron")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About Railroad Baron" }));
    expect(document.body.textContent).toContain("Railroad Baron, a posse by size: The railroads held the biggest money in the West. At least $10M of option premium traded.");
  });
});
