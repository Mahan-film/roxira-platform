import path from "node:path";
import { expect, test } from "@playwright/test";

const MOBILE_VIEWPORTS = [
  { name: "320px", width: 320, height: 640 },
  { name: "375px", width: 375, height: 812 },
  { name: "414px", width: 414, height: 896 },
  { name: "768px", width: 768, height: 1024 },
] as const;

const SCREENSHOT_DIR = process.env.EN_HEADER_SCREENSHOT_DIR;

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3999",
});

test.describe("roxira.net (/en) mobile header", () => {
  for (const vp of MOBILE_VIEWPORTS) {
    test(`fits CTA with no horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/en", { waitUntil: "domcontentloaded" });

      const cta = page.getByTestId("header-request-api-cta");
      const toggle = page.getByTestId("en-mobile-menu-toggle");

      await expect(cta).toBeVisible();
      await expect(toggle).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);

      const ctaBox = await cta.boundingBox();
      expect(ctaBox).not.toBeNull();
      expect(ctaBox!.x).toBeGreaterThanOrEqual(0);
      expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(vp.width);
    });
  }

  test("mobile menu supports focus trap, Escape close, and RTL at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en", { waitUntil: "domcontentloaded" });

    const toggle = page.getByTestId("en-mobile-menu-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    if (SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "en-header-375-closed.png") });
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const dialog = page.locator("#en-mobile-menu");
    await expect(dialog).toBeVisible();

    if (SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "en-header-375-open.png") });
    }

    // Focus must be inside the dialog after opening.
    const focusedInside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusedInside).toBe(true);

    // Tabbing multiple times stays trapped inside the dialog.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const stillInside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(stillInside).toBe(true);
    }

    // Shift+Tab from first element wraps to last element inside dialog.
    await page.keyboard.press("Shift+Tab");
    const insideAfterShiftTab = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(insideAfterShiftTab).toBe(true);

    // Escape closes the menu and restores focus to the toggle button.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    // Verify RTL layout has no horizontal overflow at 375px.
    await page.evaluate(() => {
      document.documentElement.setAttribute("dir", "rtl");
    });
    const rtlOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(rtlOverflow).toBe(false);
  });
});
