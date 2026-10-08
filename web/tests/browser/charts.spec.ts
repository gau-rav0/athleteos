import { expect, test } from "@playwright/test";

test("long-range physiological charts retain observed marks and full dates", async ({
  page,
}) => {
  await page.goto("/demo/progress");
  await page.getByRole("button", { name: "1Y", exact: true }).click();
  await expect(page.getByText(/365 days selected/)).toBeVisible();
  const weight = page.getByRole("img", { name: /^Body weight trend:/ });
  // In a long, sparse window isolated observations must remain visible even
  // when no neighbouring date supports a connecting line. Axes are not marks.
  await expect(weight.locator(".recharts-line-dot").first()).toBeVisible();
  const dots = await weight.locator(".recharts-line-dot").count();
  expect(dots).toBeGreaterThan(15);
  await weight.locator(".recharts-line-dot").last().hover();
  await expect(weight.locator(".recharts-tooltip-label")).toHaveText(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page.getByText(/7 days selected/)).toBeVisible();
  await expect(weight.locator(".recharts-line-dot").first()).toBeVisible();
  const finite = await weight
    .locator(".recharts-line-dot")
    .evaluateAll((marks) =>
      marks.every((mark) => {
        const box = (mark as SVGGraphicsElement).getBBox();
        return (
          Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0
        );
      }),
    );
  expect(finite).toBe(true);
});
