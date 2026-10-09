import { describe, expect, it } from "vitest";
import { POSSE, posseName } from "./posses.js";

describe("posse names", () => {
  it("gives every results and size group a Western name, none borrowed", () => {
    expect(Object.keys(POSSE)).toHaveLength(13);
    expect(new Set(Object.values(POSSE)).size).toBe(13);
    expect(posseName("Leviathan")).toBe("Railroad Baron");
    expect(posseName("Giga-Rekt")).toBe("Boot Hill");
    expect(posseName("Something new")).toBe("Something new");
    expect(Object.values(POSSE).join(" ")).not.toMatch(/Rekt|Whale|Shrimp|Leviathan|Dolphin|Printer|cohort/i);
  });
});
