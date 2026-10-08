/**
 * Anonymous production geometry check. Run after `next build` / `next start`,
 * or against the hosted deployment. No private sessions or recordings are used.
 * From web/: node scripts/check-production-charts.mjs https://HOST
 * This checks synthetic rendering only; authenticated data acceptance is separate.
 */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = new URL(process.argv[2] || "http://127.0.0.1:3100");
assert(["http:", "https:"].includes(base.protocol), "Expected HTTP(S) origin");
assert(
  !base.username && !base.password,
  "Credentials are forbidden in the URL",
);
base.pathname = "/";
base.search = "";
base.hash = "";
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("CLIENT_RUNTIME_ERROR"));
    for (const screen of [
      "today",
      "train",
      "recover",
      "progress",
      "insights",
    ]) {
      await page.goto(new URL(`/demo/${screen}`, base).href, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText("DEMO · synthetic data", { exact: true }).waitFor();
      for (const range of ["7D", "28D", "90D", "1Y"]) {
        const started = performance.now();
        await page.getByRole("button", { name: range, exact: true }).click();
        await page
          .getByText(
            `${range === "1Y" ? 365 : parseInt(range, 10)} days selected`,
            { exact: false },
          )
          .waitFor();
        // Grid/axes alone do not prove rendering. Wait for finite geometry in
        // every chart with supported observations, including single-point dots.
        await page.waitForFunction(
          () => {
            const charts = Array.from(
              document.querySelectorAll(".chart-canvas"),
            );
            return (
              charts.length > 0 &&
              charts.every((chart) => {
                const rect = chart.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                const marks = Array.from(
                  chart.querySelectorAll(
                    ".recharts-area-curve, .recharts-line-curve, .recharts-bar-rectangle path, .recharts-dot",
                  ),
                );
                return marks.some((mark) => {
                  const path = mark.getAttribute("d");
                  if (path && /NaN|Infinity/.test(path)) return false;
                  const box = mark.getBBox();
                  return (
                    Number.isFinite(box.x) &&
                    Number.isFinite(box.y) &&
                    Number.isFinite(box.width) &&
                    Number.isFinite(box.height) &&
                    (box.width > 0 || box.height > 0) &&
                    (mark.tagName.toLowerCase() !== "path" || !!path)
                  );
                });
              })
            );
          },
          undefined,
          { timeout: 20000 },
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          ),
          false,
          `${screen}/${range} overflows the viewport`,
        );
        report.push({
          screen,
          range,
          viewport: viewport.width,
          charts: await page.locator(".chart-canvas").count(),
          geometryWaitMs: Math.round(performance.now() - started),
        });
      }
    }
    assert.deepEqual(errors, [], "Client runtime errors occurred");
    await context.close();
  }
  console.log(
    JSON.stringify(
      {
        mode: "anonymous synthetic production geometry",
        checks: report.length,
        results: report,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
