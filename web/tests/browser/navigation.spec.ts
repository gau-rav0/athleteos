import { expect, test, type Page } from "@playwright/test";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("account navigation aborts an old owner's in-flight refresh and keeps fresh state isolated", async ({
  page,
}) => {
  await page.clock.install();
  await signIn(page, "one@synthetic.example");
  await page.getByRole("button", { name: "90D", exact: true }).click();
  await expect(page.getByText(/90 days selected/)).toBeVisible();
  await page.getByRole("combobox").selectOption("UTC");
  await expect(page.getByText(/90 days selected/)).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let oldReadStarted = false,
    oldReadAborted = false;
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/dashboard" &&
      url.searchParams.get("days") === "90"
    )
      oldReadAborted = true;
  });
  await page.route("**/api/dashboard?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("days") !== "90")
      return route.continue();
    // Capture the old account's invented response before replacing its cookies.
    const response = await route.fetch();
    const snapshot = await response.json();
    expect(snapshot.days.at(-1).steps).toBe(100);
    oldReadStarted = true;
    await held;
    try {
      await route.fulfill({ response, json: snapshot });
    } catch {
      /* The old owner's browser request was intentionally aborted. */
    }
  });
  try {
    await page.getByRole("button", { name: "Refresh dashboard" }).click();
    await expect.poll(() => oldReadStarted).toBe(true);
    const switched = await page.request.post("/api/auth/login", {
      headers: { Origin: "http://127.0.0.1:3200" },
      data: { email: "two@synthetic.example", password: "demo-only" },
    });
    expect(switched.status()).toBe(200);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Train", exact: true })
      .click();
    await expect.poll(() => oldReadAborted).toBe(true);
    await expect(page.getByText(/28 days selected/)).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveValue("Asia/Kolkata");
    const newSnapshot = await page
      .getByRole("main")
      .getAttribute("data-response-at");
    expect(newSnapshot).toBeTruthy();
    release();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Today", exact: true })
      .click();
    await expect(page.getByRole("main")).toHaveAttribute(
      "data-response-at",
      newSnapshot!,
    );
    await expect(page.getByText(/28 days selected/)).toBeVisible();
  } finally {
    release();
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(/28 days selected/)).toBeVisible();
}

test("private navigation retains its selected snapshot and logout clears it", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/dashboard")
      reads.push(request.url());
  });
  await signIn(page, "one@synthetic.example");
  await page.getByRole("button", { name: "90D", exact: true }).click();
  await expect(page.getByText(/90 days selected/)).toBeVisible();
  const timezoneRead = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/dashboard" &&
      url.searchParams.get("timezone") === "America/New_York"
    );
  });
  await page.getByRole("combobox").selectOption("America/New_York");
  expect((await timezoneRead).status()).toBe(200);
  await expect(page.getByText(/90 days selected/)).toBeVisible();
  const beforeNavigation = reads.length;
  for (const screen of ["train", "recover", "progress", "insights", "today"]) {
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: new RegExp(`^${screen}$`, "i") })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${screen}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/90 days selected/)).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveValue("America/New_York");
    // Navigation must not start another data read. Existing polling remains
    // independently scheduled, and this synthetic complete window needs none.
    expect(reads.length).toBe(beforeNavigation);
  }
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  await signIn(page, "two@synthetic.example");
  await expect(page.getByRole("combobox")).toHaveValue("Asia/Kolkata");
  await expect(
    page.getByRole("button", { name: "28D", exact: true }),
  ).toHaveClass(/selected/);
  const response = await page.request.get("/api/dashboard?days=7&timezone=UTC");
  expect((await response.json()).days.at(-1).steps).toBe(300);
});

test("cookie account switch clears a mounted snapshot before the next private screen loads data", async ({
  page,
}) => {
  await page.clock.install();
  await signIn(page, "one@synthetic.example");
  const previousSnapshot = await page
    .getByRole("main")
    .getAttribute("data-response-at");
  expect(previousSnapshot).toBeTruthy();
  const first = await page.request.get("/api/dashboard?days=7&timezone=UTC");
  expect((await first.json()).days.at(-1).steps).toBe(100);

  // Model another tab signing in: cookies change without unmounting this tab.
  // All identities and measurements belong to the invented HTTP provider.
  const switched = await page.request.post("/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:3200" },
    data: { email: "two@synthetic.example", password: "demo-only" },
  });
  expect(switched.status()).toBe(200);
  const second = await page.request.get("/api/dashboard?days=7&timezone=UTC");
  expect((await second.json()).days.at(-1).steps).toBe(300);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let newReads = 0,
    abortedReads = 0;
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/dashboard") abortedReads++;
  });
  await page.route("**/api/dashboard?*", async (route) => {
    newReads++;
    await held;
    await route.continue();
  });
  try {
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Train", exact: true })
      .click();
    await expect(page).toHaveURL(/\/train$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Build with intention.",
    );
    // Hold the new owner's read so old charts cannot be hidden by a fast response.
    await expect(page.getByRole("main")).not.toHaveAttribute(
      "data-response-at",
      previousSnapshot!,
    );
    await expect(
      page.locator(
        ".recharts-bar-rectangle, .recharts-area-curve, .recharts-line-curve",
      ),
    ).toHaveCount(0);
    // Development Strict Mode can replay the fresh owner's initial effect. Its
    // cleanup must abort the first request, leaving exactly one live data read.
    await expect.poll(() => newReads - abortedReads).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByText(/28 days selected/)).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-response-at",
    /.+/,
  );

  // Browser history can reuse a cached server leaf, unlike a new Link visit.
  // Returning to the previous owner's page must not restore their snapshot.
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(/28 days selected/)).toBeVisible();
  await expect(page.getByRole("main")).not.toHaveAttribute(
    "data-response-at",
    previousSnapshot!,
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByText(/28 days selected/)).toBeVisible();
  await expect(page.getByRole("main")).not.toHaveAttribute(
    "data-response-at",
    previousSnapshot!,
  );
});
