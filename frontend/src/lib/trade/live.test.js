import { afterEach, describe, expect, it, vi } from "vitest";
import { mainnetSwitch, mainnetSwitchState, setMainnetSwitch } from "./live.js";

afterEach(() => { vi.useRealTimers(); setMainnetSwitch(null); });
describe("published trading authorization", () => {
  const index = { trading_mainnet: "on", trading_issued_at: 1000, trading_valid_until: 1900 };
  it("rejects missing, expired, future and overlong authorization", () => {
    expect(mainnetSwitch(index, 1000)).toBe("on");
    expect(mainnetSwitch(index, 1900)).toBe("off");
    expect(mainnetSwitch(index, 999)).toBe("off");
    expect(mainnetSwitch({ trading_mainnet: "on" }, 1000)).toBe("off");
    expect(mainnetSwitch({ ...index, trading_valid_until: 1901 }, 1000)).toBe("off");
  });
  it("expires the retained switch without another network read", () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    setMainnetSwitch(index);
    expect(mainnetSwitchState()).toBe("on");
    vi.setSystemTime(1900000);
    expect(mainnetSwitchState()).toBe("off");
  });
});
