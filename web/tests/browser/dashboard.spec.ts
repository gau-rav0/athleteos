import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function signIn(page: Page, email = "one@synthetic.example") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("demo-only");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByText("Private session", { exact: true }),
  ).toBeVisible();
}
test("anonymous APIs reject and private pages redirect", async ({
  page,
  request,
}) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  const response = await request.get("/api/dashboard");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: "AUTH_REQUIRED" });
  const hostile = await request.post("/api/auth/login", {
    headers: { Origin: "https://synthetic-attacker.example" },
    data: { email: "one@synthetic.example", password: "demo-only" },
  });
  expect(hostile.status()).toBe(403);
});
test("five demo screens, ranges, drilldown, charts and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const slug of ["today", "train", "recover", "progress", "insights"]) {
    await page.goto(`/demo/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByText("DEMO · synthetic data", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link"),
    ).toHaveCount(5);
    await page.getByRole("button", { name: "90D", exact: true }).click();
    await expect(page.getByText(/90 days selected/)).toBeVisible();
    await page.getByRole("combobox").selectOption("America/New_York");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    await page
      .getByRole("button", { name: "Data quality", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close panel" }).click();
  }
  await page.goto("/demo/today");
  await page.getByRole("button", { name: "Explain Readiness" }).click();
  await expect(
    page.getByText("experimental-readiness-v0.1", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "View accessible data table" })
    .first()
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(errors).toEqual([]);
});
test("empty, sparse, partial and error states never fabricate signals", async ({
  page,
}) => {
  await page.goto("/demo/today?state=empty");
  await expect(
    page.getByText("Insufficient data", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No supported observations in this window.").first(),
  ).toBeVisible();
  await page.goto("/demo/today?state=sparse");
  await expect(
    page.getByText("Insufficient data", { exact: true }),
  ).toBeVisible();
  await page.goto("/demo/today?state=partial");
  await expect(page.getByText(/Summaries are catching up/)).toBeVisible();
  await expect(
    page.getByText("Insufficient data", { exact: true }),
  ).toBeVisible();
  await page.goto("/demo/today?state=error");
  await expect(page.getByRole("alert")).toContainText(
    "data connection unavailable",
  );
});
test("login, account ownership, isolated demo, logout and stale session", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const a = await page.request.get("/api/dashboard?days=7&timezone=UTC");
  expect(a.status()).toBe(200);
  const first = await a.json();
  expect(first.days.at(-1).steps).toBe(100);
  expect(JSON.stringify(first)).not.toContain("source_uid");
  const cookies = await page.context().cookies();
  expect(
    cookies.filter((c) => c.name.startsWith("sb-")).every((c) => c.httpOnly),
  ).toBe(true);
  await page.goto("/demo/today");
  await expect(page).toHaveURL(/\/today$/);
  const context = await browser.newContext();
  const second = await context.newPage();
  await signIn(second, "two@synthetic.example");
  const b = await second.request.get("/api/dashboard?days=7&timezone=UTC");
  expect((await b.json()).days.at(-1).steps).toBe(300);
  expect(
    (
      await (
        await page.request.get("/api/dashboard?days=7&timezone=UTC")
      ).json()
    ).days.at(-1).steps,
  ).toBe(100);
  // Verify the visible sign-out action on both viewport sizes.
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});
test("basic accessibility on login and every dashboard screen", async ({
  page,
}) => {
  for (const route of [
    "/login",
    "/demo/today",
    "/demo/train",
    "/demo/recover",
    "/demo/progress",
    "/demo/insights",
  ]) {
    await page.goto(route);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
