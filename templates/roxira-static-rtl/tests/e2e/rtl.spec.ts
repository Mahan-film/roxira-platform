import { expect, test } from "@playwright/test";

test("uses RTL and filters articles", async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("searchbox").fill("ناموجود");
  await expect(page.locator("[data-article]")).toBeHidden();
});
