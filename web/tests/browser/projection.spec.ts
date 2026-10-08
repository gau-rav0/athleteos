import { test, expect, type Page } from "@playwright/test";

const endpoint = "/api/dashboard/projection";
const origin = "http://127.0.0.1:3200";
const chartMarks =
  ".recharts-bar-rectangle, .recharts-area-curve, .recharts-line-curve";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("one@synthetic.example");
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByText("Private session", { exact: true }),
  ).toBeVisible();
}

async function servePartialSnapshot(page: Page) {
  await page.route("**/api/dashboard?*", async (route) => {
    // Use the existing invented account fixture, never a real Supabase session.
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot, partial: true } });
  });
}

test("projection mutation rejects anonymous, foreign-origin and forged-owner input", async ({
  page,
  request,
}) => {
  const body = { days: 28, timezone: "UTC" };
  const rejectedOrigins: Record<string, string>[] = [
    {},
    { Origin: "https://synthetic-attacker.example" },
  ];
  for (const headers of rejectedOrigins) {
    const response = await request.post(endpoint, { headers, data: body });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const anonymous = await request.post(endpoint, {
    headers: { Origin: origin },
    data: body,
  });
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "AUTH_REQUIRED" });

  await signIn(page);
  const own = await page.request.post(endpoint, {
    headers: { Origin: origin },
    data: body,
  });
  expect(own.status()).toBe(200);
  expect(await own.json()).toEqual({
    processed: 0,
    scanned: 0,
    remaining: false,
    busy: false,
  });
  for (const data of [
    { ...body, user_id: "00000000-0000-4000-8000-000000000002" },
    { ...body, p_limit: 1000 },
    { ...body, timezone: "Unknown/Synthetic" },
    { ...body, days: 731 },
  ]) {
    const response = await page.request.post(endpoint, {
      headers: { Origin: origin },
      data,
    });
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const oversized = await page.request.post(endpoint, {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: JSON.stringify({ ...body, synthetic: "x".repeat(5000) }),
  });
  expect(oversized.status()).toBe(413);
  const wrongType = await page.request.post(endpoint, {
    headers: { Origin: origin, "Content-Type": "text/plain" },
    data: "{}",
  });
  expect(wrongType.status()).toBe(415);
});

test("failed projection work retains cached charts and backs off", async ({
  page,
}) => {
  await page.clock.install();
  await servePartialSnapshot(page);
  let workRequests = 0;
  await page.route(`**${endpoint}`, async (route) => {
    workRequests++;
    await route.fulfill({
      status: 503,
      json: { error: "PROJECTION_WORK_UNAVAILABLE" },
    });
  });
  await signIn(page);
  await expect(page.getByText(/Summaries are catching up/)).toBeVisible();
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await page.clock.runFor(2100);
  await expect.poll(() => workRequests).toBe(1);
  await page.clock.runFor(1000);
  expect(workRequests).toBe(1);
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect.poll(() => workRequests).toBeGreaterThanOrEqual(2);
  await expect(page.locator(chartMarks).first()).toBeVisible();
});

test("slow projection work does not overlap and range changes abort old work", async ({
  page,
}) => {
  await page.clock.install();
  await servePartialSnapshot(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstRequest = true;
  let heldRequestCount = 0;
  let abortedOldWork = false;
  page.on("requestfailed", (request) => {
    if (
      new URL(request.url()).pathname === endpoint &&
      request.postDataJSON()?.days === 28
    )
      abortedOldWork = true;
  });
  await page.route(`**${endpoint}`, async (route) => {
    if (firstRequest) {
      firstRequest = false;
      heldRequestCount++;
      await held;
      // The browser intentionally canceled this synthetic request on range change.
      try {
        await route.fulfill({
          json: { processed: 0, scanned: 0, remaining: false, busy: false },
        });
      } catch {
        /* Aborted request cannot receive a response. */
      }
      return;
    }
    heldRequestCount++;
    await route.fulfill({
      json: { processed: 0, scanned: 0, remaining: false, busy: false },
    });
  });
  try {
    await signIn(page);
    await expect(page.getByText(/Summaries are catching up/)).toBeVisible();
    await expect(page.locator(chartMarks).first()).toBeVisible();
    await page.clock.runFor(2100);
    await expect.poll(() => heldRequestCount).toBe(1);
    // Run past multiple polling intervals while the worker is still unresolved.
    await page.clock.runFor(45000);
    expect(heldRequestCount).toBe(1);
    await expect(page.locator(chartMarks).first()).toBeVisible();
    await page.getByRole("button", { name: "7D", exact: true }).click();
    await expect.poll(() => abortedOldWork).toBe(true);
    await expect(page.getByText(/7 days selected/)).toBeVisible();
    await expect(page.locator(chartMarks).first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally {
    release();
  }
});

test("complete cached windows do not launch projection workers", async ({
  page,
}) => {
  await page.clock.install();
  let workerRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === endpoint) workerRequests++;
  });
  await signIn(page);
  await expect(page.locator(chartMarks).first()).toBeVisible();
  await page.clock.runFor(10000);
  expect(workerRequests).toBe(0);
});
