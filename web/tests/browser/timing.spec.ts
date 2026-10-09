import { test, expect, type Page } from "@playwright/test";

const chartMarks =
  ".recharts-bar-rectangle, .recharts-area-curve, .recharts-line-curve";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function openQuality(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("one@synthetic.example");
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await page.getByRole("button", { name: "Data quality", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function expectContainedCaption(page: Page) {
  const dialog = page.getByRole("dialog");
  const caption = dialog.getByText(/^Fact-page work:/);
  await expect(caption).toBeVisible();
  expect(
    await caption.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    }),
  ).toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await expect(caption).not.toContainText(/NaN|Infinity|undefined/);
  await expect(caption).toContainText(
    "RPC time also includes database gateway, serialization and transport work.",
  );
}

test("missing SQL timing stays unavailable in the authenticated fixture quality panel", async ({
  page,
}) => {
  let timing: { pageMs: number; decodeMs: number; sqlMs: null } | undefined;
  await page.route("**/api/dashboard?*", async (route) => {
    // The invented provider deliberately omits SQL timing; use the real decoder.
    const response = await route.fetch();
    const snapshot = await response.json();
    timing = snapshot.timings;
    await route.fulfill({ response, json: snapshot });
  });
  await openQuality(page);
  expect(timing?.sqlMs).toBeNull();
  expect(Number.isFinite(timing?.pageMs)).toBe(true);
  expect(Number.isFinite(timing?.decodeMs)).toBe(true);
  expect(timing!.pageMs).toBeGreaterThanOrEqual(0);
  expect(timing!.decodeMs).toBeGreaterThanOrEqual(0);
  const caption = page.getByRole("dialog").getByText(/^Fact-page work:/);
  await expect(caption).toContainText(`${timing!.pageMs} ms total RPC`);
  await expect(caption).toContainText(
    `${timing!.decodeMs} ms validating responses`,
  );
  await expect(caption).toContainText("SQL timing unavailable");
  await expect(caption).not.toContainText("0 ms inside SQL");
  await expectContainedCaption(page);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(chartMarks).first()).toBeVisible();
});

test("available synthetic timing counters retain exact numbers in the quality panel", async ({
  page,
}) => {
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        timings: {
          ...snapshot.timings,
          rpcMs: 123,
          analyticsMs: 7,
          pageMs: 111,
          decodeMs: 3,
          sqlMs: 42,
        },
      },
    });
  });
  await openQuality(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^Response work:/)).toContainText(
    "123 ms fetching data; 7 ms calculating summaries.",
  );
  await expect(dialog.getByText(/^Fact-page work:/)).toContainText(
    "111 ms total RPC; 42 ms inside SQL; 3 ms validating responses.",
  );
  await expect(dialog.getByText(/SQL timing unavailable/)).toHaveCount(0);
  await expectContainedCaption(page);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(chartMarks).first()).toBeVisible();
});

test("partially measured SQL remains a subset while failed RPC time stays separate", async ({
  page,
}) => {
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        timings: {
          ...snapshot.timings,
          rpcMs: 211,
          analyticsMs: 7,
          pageMs: 211,
          decodeMs: 3,
          sqlMs: null,
          sqlKnownMs: 42,
          successfulPageMs: 111,
          failedPageMs: 100,
          timedPages: 2,
          untimedPages: 1,
        },
      },
    });
  });
  await openQuality(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^Fact-page work:/)).toContainText(
    "211 ms total RPC; SQL timing unavailable; 3 ms validating responses.",
  );
  const subset = dialog.getByText(/^Observed SQL:/);
  await expect(subset).toContainText("42 ms across 2 timed pages");
  await expect(subset).toContainText("1 page timings unavailable");
  await expect(subset).toContainText("a measured subset, not total SQL time");
  await expect(subset).not.toContainText(/NaN|Infinity|undefined/);
  await expect(dialog.getByText(/42 ms inside SQL/)).toHaveCount(0);
  await expect(dialog.getByText(/Successful-page RPC:/)).toContainText(
    "Successful-page RPC: 111 ms; failed-page RPC: 100 ms.",
  );
  await expectContainedCaption(page);
  expect(
    await subset.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(chartMarks).first()).toBeVisible();
});
