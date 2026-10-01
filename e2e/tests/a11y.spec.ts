import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicPages = ["/", "/about", "/services", "/contact", "/terms", "/privacy"];

for (const path of publicPages) {
  test(`public Persian page ${path} meets critical accessibility checks`, async ({ page }) => {
    await page.goto(path);

    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", /^fa/);

    const results = await new AxeBuilder({ page }).analyze();
    const criticalViolations = results.violations.filter(
      (violation) => violation.impact === "critical",
    );
    const seriousViolations = results.violations.filter(
      (violation) => violation.impact === "serious",
    );

    if (seriousViolations.length > 0) {
      console.warn(
        `Serious accessibility violations on ${path}:`,
        seriousViolations.map(({ id, nodes }) => ({ id, nodes: nodes.length })),
      );
    }

    expect(criticalViolations).toEqual([]);
  });
}
