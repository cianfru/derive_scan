import { test, expect } from "@playwright/test";
import { mockPublicData, NOW } from "./fixtures.js";

test.use({ reducedMotion: "reduce" });

const chart = (page) => page.locator(".sch-svg");

async function visibleBubble(page) {
  const key = await page.locator(".sch-scroller").evaluate((scroller) => {
    const frame = scroller.getBoundingClientRect();
    return [...scroller.querySelectorAll(".sch-bubble:not(.sch-dot)")].map((bubble) => {
      const circle = bubble.querySelector(".sch-body circle").getBoundingClientRect();
      return { key: bubble.dataset.key, x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 };
    }).filter((point) => point.x > frame.left + 30 && point.x < Math.min(frame.right, innerWidth) - 30
      && point.y > frame.top + 90 && point.y < Math.min(frame.bottom, innerHeight) - 90)
      .sort((a, b) => Math.abs(a.y - (frame.top + frame.height / 2)) - Math.abs(b.y - (frame.top + frame.height / 2)))[0]?.key;
  });
  expect(key, "An actual bubble lies inside the visible chart, clear of its edges").toBeTruthy();
  return page.locator(`.sch-bubble[data-key="${key}"]`);
}

async function bubblePoint(bubble) {
  const bounds = await bubble.locator(".sch-body circle").first().boundingBox();
  expect(bounds).toBeTruthy();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function tapBubble(page, bubble) {
  const { x, y } = await bubblePoint(bubble);
  await page.touchscreen.tap(x, y);
}

// Native Chromium input creates trusted touch/pointer events and browser click synthesis. JS
// dispatchEvent would miss implicit pointer capture and the tap-versus-pan behaviour being checked.
async function touch(client, type, points) {
  await client.send("Input.dispatchTouchEvent", {
    type, touchPoints: points.map((point, index) => ({ ...point, id: index + 1, radiusX: 5, radiusY: 5, force: 1 })),
  });
}

async function chartScale(page) {
  return chart(page).evaluate((svg) => {
    const levels = [...svg.querySelectorAll(".sch-bubble")].map((bubble) => {
      const zone = /-A-([\d_]+)-([\d_]+)/.exec(bubble.dataset.key);
      return { price: (Number(zone[1].replace("_", ".")) + Number(zone[2].replace("_", "."))) / 2,
        y: Number(bubble.querySelector(".sch-body circle").getAttribute("cy")) };
    });
    const first = levels[0], second = levels.find((level) => level.price !== first.price);
    return Math.abs((second.y - first.y) / (second.price - first.price));
  });
}

test("a native phone tap opens its outcome, while a thumb pan on a bubble moves the chart", async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, "Native touch belongs to the phone project.");
  await mockPublicData(page);
  await page.goto("/saloon?coin=BTC");
  await expect(chart(page)).toBeVisible();
  await expect(page.locator(".sch-bubble:not(.sch-dot)").first()).toBeVisible();
  let bubble = await visibleBubble(page);
  const chosenKey = await bubble.getAttribute("data-key");
  await tapBubble(page, bubble);
  const panel = page.getByRole("dialog", { name: "Your trade" });
  await expect(panel).toBeVisible();
  const [id, side] = chosenKey.split(":");
  expect(new URL(page.url()).searchParams.get("outcome")).toBe(id);
  expect(new URL(page.url()).searchParams.get("side")).toBe(side);
  await panel.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => {
    window.chartTouchEvents = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click"]) {
      document.addEventListener(type, (event) => window.chartTouchEvents.push({ type, pointerType: event.pointerType,
        pointerId: event.pointerId, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
        key: event.target.closest?.(".sch-bubble")?.getAttribute("data-key"), tag: event.target.tagName }), true);
    }
  });

  bubble = await visibleBubble(page);
  const panKey = await bubble.getAttribute("data-key");
  const beforeY = await bubble.locator(".sch-body circle").first().getAttribute("cy");
  const beforeLeft = await page.locator(".sch-scroller").evaluate((el) => el.scrollLeft);
  const start = await bubblePoint(bubble);
  const client = await page.context().newCDPSession(page);
  try {
    await touch(client, "touchStart", [start]);
    for (let step = 1; step <= 8; step++) {
      await touch(client, "touchMove", [{ x: start.x - step * 9, y: start.y + step * 7 }]);
    }
    await touch(client, "touchEnd", []);
    await expect(page.locator(".sl-panel")).toHaveCount(0);
    await expect.poll(() => page.locator(".sch-scroller").evaluate((el) => el.scrollLeft)).toBeGreaterThan(beforeLeft + 40);
    const movedBubble = page.locator(`.sch-bubble[data-key="${panKey}"]`);
    await expect.poll(async () => Number(await movedBubble.locator(".sch-body circle").first().getAttribute("cy"))).toBeGreaterThan(Number(beforeY) + 35);
    await expect(chart(page)).not.toHaveClass(/\bdrag\b/);

    // A completed pan must not suppress the next ordinary tap.
    bubble = await visibleBubble(page);
    const nextKey = await bubble.getAttribute("data-key");
    await tapBubble(page, bubble);
    await expect(page.getByRole("dialog", { name: "Your trade" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("outcome")).toBe(nextKey.split(":")[0]);
    expect(new URL(page.url()).searchParams.get("side")).toBe(nextKey.split(":")[1]);
    const events = await page.evaluate(() => window.chartTouchEvents);
    const presses = events.filter((event) => event.type === "pointerdown");
    expect(presses.length).toBeGreaterThanOrEqual(2);
    expect(presses.every((event) => event.trusted && event.pointerType === "touch")).toBe(true);
  } catch (error) {
    await testInfo.attach("native-touch-events", { body: JSON.stringify(await page.evaluate(() => window.chartTouchEvents), null, 2), contentType: "application/json" });
    throw error;
  } finally {
    await client.detach();
  }
});

test("a native two-finger phone pinch zooms without choosing an outcome and preserves later pans and taps", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Native touch belongs to the phone project.");
  await mockPublicData(page);
  await page.goto("/saloon?coin=BTC");
  await expect(chart(page)).toBeVisible();
  await expect(page.locator(".sch-bubble").first()).toBeVisible();
  const beforeScale = await chartScale(page);
  const bounds = await page.locator(".sch-scroller").boundingBox();
  const center = { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.5 };
  const client = await page.context().newCDPSession(page);
  try {
    await touch(client, "touchStart", [{ x: center.x, y: center.y - 45 }, { x: center.x, y: center.y + 45 }]);
    for (let step = 1; step <= 7; step++) {
      const gap = 45 + step * 5;
      await touch(client, "touchMove", [{ x: center.x, y: center.y - gap }, { x: center.x, y: center.y + gap }]);
    }
    await touch(client, "touchEnd", []);
    await expect.poll(() => chartScale(page)).toBeGreaterThan(beforeScale * 1.5);
    await expect(page.locator(".sl-panel")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("outcome")).toBe(false);
    await expect(chart(page)).not.toHaveClass(/\bdrag\b/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Both pinch pointers must be cleared: a new single finger pans, then a tap selects.
    let bubble = await visibleBubble(page);
    const panKey = await bubble.getAttribute("data-key");
    const beforeY = Number(await bubble.locator(".sch-body circle").first().getAttribute("cy"));
    const start = await bubblePoint(bubble);
    await touch(client, "touchStart", [start]);
    for (let step = 1; step <= 5; step++) await touch(client, "touchMove", [{ x: start.x, y: start.y + step * 6 }]);
    await touch(client, "touchEnd", []);
    await expect.poll(async () => Number(await page.locator(`.sch-bubble[data-key="${panKey}"] .sch-body circle`).first().getAttribute("cy"))).toBeGreaterThan(beforeY + 18);
    await expect(page.locator(".sl-panel")).toHaveCount(0);
    await expect(chart(page)).not.toHaveClass(/\bdrag\b/);
    bubble = await visibleBubble(page);
    const nextKey = await bubble.getAttribute("data-key");
    await tapBubble(page, bubble);
    await expect(page.getByRole("dialog", { name: "Your trade" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("outcome")).toBe(nextKey.split(":")[0]);
    expect(new URL(page.url()).searchParams.get("side")).toBe(nextKey.split(":")[1]);
  } finally {
    await client.detach();
  }
});

test("live index crossings retain the focused level and an explicit trade's side and budget", async ({ page }) => {
  const feed = await mockPublicData(page, { live: true });
  const id = "BTC-20261009-A-82000-88000";
  await page.goto("/saloon?coin=BTC");
  // Parallel Chromium workers can finish the Vite graph before delivering the mocked socket's
  // first subscription. Wait for that tick, rather than racing initial chart construction.
  await expect(page.locator('.sl-ctab[data-und="BTC"] .ct-price')).toHaveText("$85,000", { timeout: 15_000 });
  const higher = page.locator(`.sch-bubble[data-key="${id}:yes"]`);
  await expect(higher).toBeVisible();
  await higher.focus();
  feed.pushPrice("BTC", 85001, NOW);
  const lower = page.locator(`.sch-bubble[data-key="${id}:no"]`);
  await expect(lower).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-key"))).toBe(`${id}:no`);
  await expect(page.locator(".sl-panel")).toHaveCount(0);

  await page.keyboard.press("Enter");
  const panel = page.locator(".sl-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "BTC lower than $85,000?", exact: true })).toBeVisible();
  await panel.locator("#sl-dollars").fill("250.50");
  feed.pushPrice("BTC", 84000, NOW);
  await expect(page.locator(`.sch-bubble[data-key="${id}:yes"]`)).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: "BTC lower than $85,000?", exact: true })).toBeVisible();
  await expect(panel.locator("#sl-dollars")).toHaveValue("250.50");
  await expect(panel.locator(".sl-when")).toContainText("$84,000");
  const params = new URL(page.url()).searchParams;
  expect(params.get("outcome")).toBe(id);
  expect(params.get("side")).toBe("no");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cowboy-decision")).outcome)).toMatchObject({ id, side: "no", und: "BTC" });
});
