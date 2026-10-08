import { test, expect, type Page } from "@playwright/test";

const inventoryEndpoint = "/api/dashboard/inventory";
const projectionEndpoint = "/api/dashboard/projection";
const chartMarks =
  ".recharts-bar-rectangle, .recharts-area-curve, .recharts-line-curve";

test.afterEach(async ({ page }) => {
  // Range cancellation can leave route.fetch's independent synthetic API
  // request finishing after the browser aborted its original request.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("one@synthetic.example");
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator(chartMarks).first()).toBeVisible();
}

async function staleInventory(page: Page, partial: boolean) {
  await page.route("**/api/dashboard?*", async (route) => {
    // Only invented HTTP-provider fixtures; no private account or raw payload.
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        partial,
        inventoryAvailable: true,
        inventorySnapshot: {
          as_of: "2025-01-01T00:00:00Z",
          stale: true,
          available: true,
          refresh_required: true,
        },
      },
    });
  });
}

test("inventory failures back off without hiding complete cached charts", async ({
  page,
}) => {
  await page.clock.install();
  await staleInventory(page, false);
  let inventoryRequests = 0,
    projectionRequests = 0;
  await page.route(`**${inventoryEndpoint}`, async (route) => {
    inventoryRequests++;
    await route.fulfill({
      status: 503,
      json: { error: "INVENTORY_REFRESH_UNAVAILABLE" },
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === projectionEndpoint)
      projectionRequests++;
  });
  await signIn(page);
  await page.clock.runFor(2100);
  await expect.poll(() => inventoryRequests).toBe(1);
  await page.clock.runFor(1000);
  expect(inventoryRequests).toBe(1);
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect.poll(() => inventoryRequests).toBeGreaterThanOrEqual(2);
  expect(projectionRequests).toBe(0);
});

test("failed inventory does not starve projection and maintenance POSTs do not overlap", async ({
  page,
}) => {
  await page.clock.install();
  await staleInventory(page, true);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    maximumActive = 0,
    inventories = 0,
    projections = 0;
  await page.route("**/api/dashboard/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      if (path === inventoryEndpoint) {
        inventories++;
        await route.fulfill({
          status: 503,
          json: { error: "INVENTORY_REFRESH_UNAVAILABLE" },
        });
      } else if (path === projectionEndpoint) {
        projections++;
        await held;
        try {
          await route.fulfill({
            json: { processed: 0, scanned: 0, remaining: true, busy: false },
          });
        } catch {
          /* Test cleanup may cancel the held synthetic request. */
        }
      } else await route.continue();
    } finally {
      active--;
    }
  });
  try {
    await signIn(page);
    await page.clock.runFor(2100);
    await expect.poll(() => inventories).toBe(1);
    await page.clock.runFor(100);
    await expect.poll(() => projections).toBe(1);
    await page.clock.runFor(45000);
    expect(maximumActive).toBe(1);
    expect(projections).toBe(1);
    expect(inventories).toBe(1);
    await expect(page.locator(chartMarks).first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally {
    release();
  }
});

test("range changes abort slow inventory maintenance and retain correct-range charts", async ({
  page,
}) => {
  await page.clock.install();
  await staleInventory(page, true);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inventories = 0,
    projections = 0,
    aborted = false;
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === inventoryEndpoint) aborted = true;
  });
  await page.route(`**${inventoryEndpoint}`, async (route) => {
    inventories++;
    await held;
    try {
      await route.fulfill({
        json: {
          refreshed: false,
          busy: false,
          snapshot: {
            as_of: null,
            available: false,
            stale: true,
            refresh_required: true,
          },
        },
      });
    } catch {
      /* Superseded request was intentionally canceled. */
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === projectionEndpoint) projections++;
  });
  try {
    await signIn(page);
    await page.clock.runFor(2100);
    await expect.poll(() => inventories).toBe(1);
    await page.clock.runFor(45000);
    expect(projections).toBe(0);
    expect(inventories).toBe(1);
    await page.getByRole("button", { name: "7D", exact: true }).click();
    await expect.poll(() => aborted).toBe(true);
    release();
    await expect(page.getByText(/7 days selected/)).toBeVisible();
    await expect(page.locator(chartMarks).first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally {
    release();
  }
});
