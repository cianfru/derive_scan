import { describe, expect, it } from "vitest";
import { EVERYONE, isPilot, parsePilot } from "./pilot.js";

const A = "0x28fb86d294b714368d47d6b371ed78d4399c4341";

describe("pilot list", () => {
  it("lists addresses, drops anything else, and is nobody when empty", () => {
    expect([...parsePilot(`${A}, nope`)]).toEqual([A]);
    expect(parsePilot("").size).toBe(0);
    expect(isPilot(A, parsePilot(""))).toBe(false);
    expect(isPilot("0x0000000000000000000000000000000000000001", parsePilot(A))).toBe(false);
  });
  it("opens to every wallet with 'all'", () => {
    const all = parsePilot(" ALL ");
    expect(all.has(EVERYONE)).toBe(true);
    expect(isPilot("0x0000000000000000000000000000000000000001", all)).toBe(true);
    expect(isPilot(undefined, all)).toBe(false); // still needs a connected wallet
  });
});
