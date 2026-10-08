import { expect, test, type Page } from "@playwright/test";

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
