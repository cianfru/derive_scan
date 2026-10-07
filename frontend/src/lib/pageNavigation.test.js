import { expect, it } from "vitest";
import { pageTitle } from "./pageNavigation.js";

it("names research and personal views without leaking wallet identifiers", () => {
  expect(pageTitle("/coin/BTC")).toBe("BTC · Markets · Cowboy");
  expect(pageTitle("/saloon", "?coin=HYPE")).toBe("HYPE · Saloon · Cowboy");
  expect(pageTitle("/saloon/mine", "?tab=following")).toBe("Following · Cowboy");
  expect(pageTitle("/trader/0x1234")).toBe("Trader profile · Cowboy");
});
