// Browser check for #281: sidebar scrolls, page never turns white. Mocked API, native Chrome.
// Usage: BASE=http://127.0.0.1:3951 node check.mjs  (needs @playwright/test resolvable, e.g. run from e2e/)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const out = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:3951';
const session = {
  accessToken: 'aaa.bbb.ccc', tokenType: 'Bearer', expiresAt: Date.now() + 3600e3, refreshToken: 'mock', refreshExpiresAt: Date.now() + 3600e3,
  user: { id: 'u1', phone: null, displayName: 'Demo', email: 'demo@example.test', role: 'ADMIN', serviceDomain: 'roxira', createdAt: '2026-01-01T00:00:00Z' },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
for (const [w, h] of [[1280, 360], [375, 360]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((s) => localStorage.setItem('roxira.auth.session', JSON.stringify(s)), session);
  const page = await ctx.newPage();
  await page.route((u) => u.port !== new URL(BASE).port && !u.href.startsWith('data:'), (r) => r.abort());
  await page.route(/\/auth\/me/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) }));
  await page.route(/\/(api|auth)\/(?!.*\/auth\/me)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
  if (w < 768 && !(await page.locator('[data-testid="app-sidebar-nav"]:visible').count())) { await page.getByRole('button', { name: /منو|menu/i }).first().click({ timeout: 5000 }).catch(() => {}); }
  const nav = page.locator('[data-testid="app-sidebar-nav"]:visible').first();
  await nav.waitFor({ state: 'visible', timeout: 30000 }).catch(async (e) => { console.log(page.url(), (await page.locator('body').innerText()).slice(0,300)); throw e; });
  const m = await page.evaluate(async () => {
    const nav = [...document.querySelectorAll('[data-testid="app-sidebar-nav"]')].find((n) => n.getClientRects().length > 0);
    const before = nav.scrollTop; nav.scrollTo({ top: nav.scrollHeight });
    await new Promise((r) => setTimeout(r, 300));
    const px = (el) => getComputedStyle(el).backgroundColor;
    return { clientH: nav.clientHeight, scrollH: nav.scrollHeight, scrollTopBefore: before, scrollTopAfter: nav.scrollTop,
      html: px(document.documentElement), body: px(document.body), aside: px(nav.closest('aside') || nav.parentElement),
      docScrollH: document.documentElement.scrollHeight, innerH: innerHeight };
  });
  await page.screenshot({ path: path.join(out, `sidebar-${w}.png`) });
  results.push({ width: w, height: h, ...m });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
