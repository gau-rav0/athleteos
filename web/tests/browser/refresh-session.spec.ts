import { expect, test, type Page } from "@playwright/test";

const chartMarks =
  ".recharts-bar-rectangle, .recharts-area-curve, .recharts-line-curve";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("one@synthetic.example");
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 15000 });
  await expect(page.locator(chartMarks).first()).toBeVisible();
}

test("failed manual refresh retains the loaded private snapshot and retry recovers", async ({
  page,
}) => {
  await page.clock.install();
  await signIn(page);
  const responseAt = await page
    .getByRole("main")
    .getAttribute("data-response-at");
  expect(responseAt).toBeTruthy();
  let reads = 0;
  await page.route("**/api/dashboard?*", async (route) => {
    reads++;
    if (reads === 1)
      await route.fulfill({
        status: 503,
        json: { error: "DATA_UNAVAILABLE" },
      });
    else await route.continue();
  });

  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not refresh your dashboard",
  );
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-response-at",
    responseAt!,
  );
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await expect(page.getByText(/28 days selected/)).toBeVisible();
  expect(reads).toBe(1);

  const retry = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect((await retry).status()).toBe(200);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator(chartMarks).first()).toBeVisible();
  expect(reads).toBe(2);
});

for (const endpoint of [
  "/api/dashboard",
  "/api/dashboard/projection",
  "/api/dashboard/inventory",
]) {
  test(`${endpoint} 401 clears the loaded private snapshot before login navigation`, async ({
    page,
  }) => {
    await page.clock.install();
    if (endpoint !== "/api/dashboard") {
      await page.route("**/api/dashboard?*", async (route) => {
        // Invented provider fixtures only. Schedule exactly the worker under test.
        const response = await route.fetch();
        const snapshot = await response.json();
        const projection = endpoint.endsWith("/projection");
        await route.fulfill({
          response,
          json: {
            ...snapshot,
            partial: projection,
            projectionPending: projection,
            partialReasons: projection ? ["PROJECTION_PENDING"] : [],
            inventoryAvailable: true,
            inventorySnapshot: {
              as_of: "2025-01-01T00:00:00Z",
              available: true,
              stale: !projection,
              refresh_required: !projection,
            },
          },
        });
      });
    }
    await signIn(page);
    await page.getByRole("button", { name: "Explain Readiness" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    let observedState: unknown;
    await page.exposeFunction("reportPrivateSessionState", (value: unknown) => {
      observedState = value;
    });
    await page.evaluate((marks) => {
      const report = () => {
        const state = {
          heading: document.querySelector("h1")?.textContent,
          responseAt: document
            .querySelector("main")
            ?.getAttribute("data-response-at"),
          charts: document.querySelectorAll(marks).length,
          explanation: document.body.textContent?.includes(
            "experimental-readiness-v0.1",
          ),
        };
        void (
          window as typeof window & {
            reportPrivateSessionState: (state: unknown) => Promise<void>;
          }
        ).reportPrivateSessionState(state);
      };
      new MutationObserver(report).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      report();
    }, chartMarks);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loginStarted = false;
    await page.route("**/login", async (route) => {
      // Holding the document navigation proves snapshot clearing happens in the
      // existing dashboard, before the browser can discard its entire document.
      loginStarted = true;
      await held;
      await route.continue();
    });
    let denied = 0;
    await page.route(
      endpoint === "/api/dashboard" ? "**/api/dashboard?*" : `**${endpoint}`,
      async (route) => {
        denied++;
        // Model an expired synthetic session so the login page can stay visible.
        await page.context().clearCookies();
        await route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
      },
    );
    try {
      if (endpoint === "/api/dashboard") {
        await page.getByRole("button", { name: "Close panel" }).click();
        await page.getByRole("button", { name: "Refresh dashboard" }).click();
      } else await page.clock.runFor(2100);
      await expect.poll(() => loginStarted).toBe(true);
      expect(denied).toBe(1);
      // Page operations wait for document navigation. The observer reports React
      // commits from the old document, before the held login page can replace it.
      await expect
        .poll(() => observedState)
        .toEqual({
          heading: "Make today count.",
          responseAt: null,
          charts: 0,
          explanation: false,
        });
    } finally {
      release();
    }
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  });
}
