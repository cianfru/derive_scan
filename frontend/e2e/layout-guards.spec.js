import { test, expect } from "@playwright/test";
import { mockPublicData } from "./fixtures.js";

// Owner's rules (8 October 2026, after they slipped): the landing's first screen shows the hero alone,
// board tiles never overflow, and the landing example reads in percentages like the Saloon.

test("the landing's first screen shows the hero alone", async ({ page }) => {
  for (const height of [664, 844]) {
    await page.setViewportSize({ width: page.viewportSize().width, height });
    await page.goto("/");
    const r = await page.evaluate(() => {
      const stage = document.querySelector(".hero-stage");
      return { next: stage.nextElementSibling.getBoundingClientRect().top, vh: innerHeight };
    });
    expect(r.next).toBeGreaterThanOrEqual(r.vh - 1);
  }
});

test("the landing example shows returns as percentages", async ({ page }) => {
  await page.goto("/");
  const labels = await page.locator(".sd-bubble b").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).toMatch(/^\+\d+%$/);
});

test("board tiles keep their figures inside", async ({ page }) => {
  await mockPublicData(page);
  await page.goto("/saloon?view=list");
  await expect(page.locator(".bd-choice").first()).toBeVisible();
  const spill = await page.evaluate(() => [...document.querySelectorAll(".bd-choice")].filter((t) => {
    const box = t.getBoundingClientRect();
    return [...t.querySelectorAll("*")].some((c) => c.getBoundingClientRect().right > box.right + 1);
  }).length);
  expect(spill).toBe(0);
});
