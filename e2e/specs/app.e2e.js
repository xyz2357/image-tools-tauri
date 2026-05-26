import { test, expect } from "../fixtures.js";

test("launches with the image-tools tab active", async ({ appPage: page }) => {
  await expect(page.locator("button[data-tab='image-tools']")).toHaveClass(/active/);
  await expect(page.locator("button[data-tab='conversion']")).toBeVisible();
});

test("conversion tab exposes the ugoira format", async ({ appPage: page }) => {
  await page.locator("button[data-tab='conversion']").click();
  const values = await page.locator("#conv-format option").evaluateAll((opts) => opts.map((o) => o.value));
  expect(values).toContain("ugoira");
  expect(values).toContain("gif");
});
