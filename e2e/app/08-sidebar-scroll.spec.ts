import { test, expect, openApp } from './fixtures';
import type { Locator } from '@playwright/test';

/**
 * App shell sidebar on a short screen (#277): the menu is taller than 768 px, so the nav must scroll
 * inside the dark sidebar instead of spilling onto a white page, and the account footer stays visible.
 */
test.use({ viewport: { width: 1280, height: 768 } });

/** Relative luminance (0 black, 1 white) of what is painted behind the element, alpha-composited up to <html>. */
async function backdropLuminance(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // The canvas resolves any CSS colour syntax (oklch, color-mix, ...) to sRGB.
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const layers: Array<[number, number, number, number]> = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      layers.push(toRgba(getComputedStyle(node).backgroundColor));
    }
    // The browser canvas behind <html> is white unless a layer covers it.
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la] of layers.reverse()) {
      r = lr * la + r * (1 - la);
      g = lg * la + g * (1 - la);
      b = lb * la + b * (1 - la);
    }
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  });
}

test('sidebar scrolls inside a dark background at 768 px height', async ({ page }) => {
  await openApp(page, '/app');

  const nav = page.getByTestId('app-sidebar-nav');
  await expect(nav).toBeVisible();
  // The page itself is dark too, so nothing white can show past the shell.
  expect(await backdropLuminance(page.locator('body'))).toBeLessThan(0.1);

  const scrolls = await nav.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls, 'menu should be taller than the nav at 768 px').toBe(true);
  await nav.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

  const lastItem = nav.getByRole('link').last();
  await expect(lastItem).toBeInViewport();
  expect(await backdropLuminance(lastItem)).toBeLessThan(0.1);

  // The account footer stays on screen while the nav scrolls.
  await expect(page.locator('aside').getByRole('button', { name: 'خروج از حساب' })).toBeInViewport();
});
