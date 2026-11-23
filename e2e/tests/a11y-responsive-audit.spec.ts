import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AUDIT_OUTPUT_DIR,
  AUDITED_PAGE_GROUPS,
  detectClippedText,
  detectHorizontalOverflow,
  runAxeAudit,
  saveAuditReport,
  type PageAuditFinding,
} from './helpers/a11y-responsive-audit';

/**
 * T356 (issue #1329): QA: accessibility, right-to-left and phone-width audit of all app pages.
 *
 * Requirements:
 *  - Visits each page at 390 px (mobile) and 1440 px (desktop).
 *  - Tests both directions (RTL and LTR).
 *  - Runs Axe accessibility engine on each page state.
 *  - Checks for horizontal scroll / page overflow.
 *  - Checks for clipped text / broken layout boundaries.
 *  - Writes one comprehensive report with screenshots stored outside the repo.
 *  - Files structured findings per page group with fixes ordered by severity.
 */

const VIEWPORTS = [
  { name: 'phone-390px', width: 390, height: 844 },
  { name: 'desktop-1440px', width: 1440, height: 900 },
] as const;

const DIRECTIONS: Array<'rtl' | 'ltr'> = ['rtl', 'ltr'];

test.describe('T356 · Accessibility, RTL and Phone-Width Audit', () => {
  const allFindings: PageAuditFinding[] = [];

  test.afterAll(async () => {
    if (allFindings.length > 0) {
      const { reportPath, issuesDir } = saveAuditReport(allFindings);
      // eslint-disable-next-line no-console
      console.log(`[T356] Full audit report saved to: ${reportPath}`);
      // eslint-disable-next-line no-console
      console.log(`[T356] Severity-ordered issue templates generated in: ${issuesDir}`);
    }
  });

  for (const group of AUDITED_PAGE_GROUPS) {
    test.describe(`Page Group: ${group.name}`, () => {
      for (const route of group.routes) {
        for (const vp of VIEWPORTS) {
          for (const dir of DIRECTIONS) {
            test(`audit ${route} @ ${vp.width}px (${dir.toUpperCase()})`, async ({ page }) => {
              await page.setViewportSize({ width: vp.width, height: vp.height });

              const response = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => null);
              if (!response) {
                test.skip(true, `Route ${route} not reachable on current base URL`);
                return;
              }

              // Apply direction
              await page.evaluate((d) => {
                document.documentElement.setAttribute('dir', d);
              }, dir);

              await page.waitForTimeout(300);

              // 1. Horizontal overflow check
              const overflow = await detectHorizontalOverflow(page);

              // 2. Clipped text check
              const clipped = await detectClippedText(page);

              // 3. Axe audit
              const axeViolations = await runAxeAudit(page);

              // 4. Capture screenshot outside repo
              const screenshotsDir = path.join(AUDIT_OUTPUT_DIR, 'screenshots');
              fs.mkdirSync(screenshotsDir, { recursive: true });
              const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
              const shotPath = path.join(screenshotsDir, `${slug}-${vp.width}px-${dir}.png`);
              await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);

              allFindings.push({
                route,
                group: group.name,
                viewportWidth: vp.width,
                direction: dir,
                hasHorizontalOverflow: overflow.hasOverflow,
                scrollWidth: overflow.scrollWidth,
                clientWidth: overflow.clientWidth,
                overflowElements: overflow.offenders,
                clippedTextCount: clipped.count,
                clippedSnippets: clipped.snippets,
                axeViolations,
                screenshotPath: shotPath,
              });

              // Critical accessibility violations fail the spec so CI / QA flags blocker issues immediately
              const criticalAxe = axeViolations.filter((v) => v.impact === 'critical');
              expect(
                criticalAxe,
                `Critical accessibility violations found on ${route} (${vp.width}px, ${dir}): ${criticalAxe.map((c) => c.id).join(', ')}`,
              ).toEqual([]);
            });
          }
        }
      }
    });
  }
});
