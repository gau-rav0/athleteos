import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("synthetic responsive design matrix", async ({ page }) => {
  test.setTimeout(240000);
  const output = process.env.ATHLETEOS_DESIGN_OUTPUT;
  if (output) {
    const path = resolve(output);
    expect(path.startsWith(resolve(process.cwd()))).toBe(false);
    await mkdir(path, { recursive: true });
  }
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const screen of [
      "today",
      "train",
      "recover",
      "progress",
      "insights",
    ]) {
      await page.goto(`/demo/${screen}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".chart-canvas svg").first()).toBeVisible();
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        cards: Array.from(document.querySelectorAll(".card")).every((card) => {
          const r = card.getBoundingClientRect();
          return (
            r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1
          );
        }),
        nav: Array.from(document.querySelectorAll(".sidebar nav a")).every(
          (link) => link.getBoundingClientRect().height >= 44,
        ),
      }));
      expect(geometry).toEqual({ overflow: false, cards: true, nav: true });
      if (output)
        await page.screenshot({
          path: resolve(output, `synthetic-${screen}-${width}.png`),
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 360, height: 844 });
  for (const state of ["empty", "partial"]) {
    for (const screen of [
      "today",
      "train",
      "recover",
      "progress",
      "insights",
    ]) {
      await page.goto(`/demo/${screen}?state=${state}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
      if (output)
        await page.screenshot({
          path: resolve(output, `synthetic-${screen}-${state}-360.png`),
          fullPage: true,
        });
    }
  }
});
