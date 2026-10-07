import { test, expect } from "@playwright/test";
import { mockPublicData } from "./fixtures.js";

const openBubble = async (page, index = 0) => {
  const bubble = page.locator('.sch-bubble:not(.sch-dot)').nth(index);
  await expect(bubble).toBeVisible();
  await bubble.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sl-panel")).toBeVisible();
};

test("market name search survives opening a coin and browser Back", async ({ page }) => {
  await mockPublicData(page);
  await page.goto("/markets");
  await page.getByRole("textbox", { name: "Find a market" }).fill("Bitcoin");
  await expect(page.getByRole("article", { name: "BTC market" })).toBeVisible();
  await expect(page.getByRole("article", { name: "HYPE market" })).toHaveCount(0);
  const coinLink = page.getByRole("link", { name: "Open BTC chart and data" });
  await coinLink.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await coinLink.click();
  await expect(page).toHaveTitle("BTC · Markets · Cowboy");
  await expect(page.getByRole("heading", { name: /Bitcoin/ }).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Find a market" })).toHaveValue("Bitcoin");
  await expect(page).toHaveTitle("Markets · Cowboy");
  await expect.poll(() => page.evaluate((before) => Math.abs(scrollY - before), scroll)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("coin and decimal budget survive chart, list and full details", async ({ page }) => {
  await mockPublicData(page);
  await page.goto("/saloon?coin=HYPE");
  await openBubble(page);
  await page.locator("#sl-dollars").fill("250.50");
  await page.getByRole("link", { name: /Full details/ }).click();
  await expect(page).toHaveURL(/\/q\/HYPE-/);
  await expect(page.locator('input[inputmode="decimal"]').first()).toHaveValue("250.50");
  await page.getByRole("link", { name: /All outcomes/ }).click();
  await expect(page.getByRole("tab", { name: /Hyperliquid/ })).toHaveAttribute("aria-selected", "true");
  const close = page.locator(".sl-panel").getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole("link", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/coin=HYPE/);
  await page.getByRole("link", { name: "Chart", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Hyperliquid/ })).toHaveAttribute("aria-selected", "true");
  await openBubble(page, 1);
  await expect(page.locator("#sl-dollars")).toHaveValue("250.50");
});

test("mobile help owns Escape and the panel keeps keyboard focus", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The desktop panel leaves the chart interactive.");
  await mockPublicData(page);
  await page.goto("/saloon?coin=BTC");
  await openBubble(page);
  const panel = page.getByRole("dialog", { name: "Your trade" });
  await panel.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await panel.getByRole("button", { name: "About the amount", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "About the amount", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "About the amount", exact: true })).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Review trade", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Back to payout", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Review trade", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("sch-bubble"))).toBe(true);
});

test("a missing selected board never silently substitutes another coin", async ({ page }) => {
  await mockPublicData(page, { fail: ["questions/HYPE.json"] });
  await page.goto("/saloon?coin=HYPE");
  await expect(page.getByRole("tab", { name: /Hyperliquid/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Retry/i }).first()).toBeVisible();
  await expect(page.locator(".sch-bubble")).toHaveCount(0);
  await expect(page).toHaveURL(/coin=HYPE/);
});

test("a chart-feed failure presents a recovery action", async ({ page }) => {
  await mockPublicData(page, { fail: ["coins/BTC.json"] });
  await page.goto("/saloon?coin=BTC");
  await expect(page.getByRole("heading", { name: "BTC chart data is unavailable." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator(".sch-stage")).toHaveCount(0);
});

test("a disconnected index is visibly qualified", async ({ page }) => {
  const feed = await mockPublicData(page, { live: true });
  await page.goto("/saloon?coin=BTC");
  await openBubble(page);
  await expect(page.locator(".decision-price-note")).toContainText(/Live/);
  feed.disconnect();
  await expect(page.locator(".decision-price-note")).toContainText(/disconnect|reconnect|last/i);
});

test("two chosen outcomes compare at one decimal budget", async ({ page }) => {
  await mockPublicData(page);
  await page.goto("/saloon?coin=BTC");
  await openBubble(page);
  await page.locator(".sl-panel").getByRole("button", { name: /^Compare BTC/ }).click();
  await page.locator(".sl-panel").getByRole("button", { name: "Close", exact: true }).click();
  await openBubble(page, 1);
  await page.locator(".sl-panel").getByRole("button", { name: /^Compare BTC/ }).click();
  await page.locator(".sl-panel").getByRole("button", { name: "View comparison (2)", exact: true }).click();
  await expect(page.locator(".sl-panel")).toHaveCount(0);
  const comparison = page.getByRole("region", { name: "Compare outcomes", exact: true });
  await expect(comparison.getByRole("article")).toHaveCount(2);
  const previous = await comparison.locator(".oc-facts").first().textContent();
  await page.getByRole("textbox", { name: "Comparison amount, fees included" }).fill("50.50");
  await expect(comparison).toContainText("For $50.50 each · fees included");
  await expect(comparison.locator(".oc-facts").first()).not.toHaveText(previous);
  await expect(comparison.getByText("You pay / most you can lose", { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("comparison.png"), fullPage: true });
});

test("narrow phone navigation keeps Traders and My space separate", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Narrow phone layout.");
  await page.setViewportSize({ width: 320, height: 844 });
  await mockPublicData(page);
  await page.goto("/markets");
  const traders = page.getByRole("button", { name: "Traders", exact: true });
  const space = page.getByRole("button", { name: "My space", exact: true });
  const a = await traders.boundingBox(), b = await space.boundingBox();
  expect(a.x + a.width).toBeLessThanOrEqual(b.x - 4);
  await traders.click();
  await expect(page.getByRole("link", { name: "Cohorts", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await space.click();
  await expect(page.getByRole("link", { name: "Following", exact: true })).toBeVisible();
});
