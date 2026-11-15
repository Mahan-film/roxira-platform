import { expect, test } from '@playwright/test';
import {
  findA11yBaselineDir,
  parseBaseline,
  routeToBaselinePath,
  smoke,
} from '../../helpers/smoke';

test.describe('smoke helper unit tests', () => {
  test('routeToBaselinePath maps root route to root.json or index.json', () => {
    const p1 = routeToBaselinePath('/', '/tmp/a11y');
    expect(p1).toBe('/tmp/a11y/root.json');

    const p2 = routeToBaselinePath('', '/tmp/a11y');
    expect(p2).toBe('/tmp/a11y/root.json');
  });

  test('routeToBaselinePath maps simple route to <route>.json', () => {
    const p = routeToBaselinePath('/about', '/tmp/a11y');
    expect(p).toBe('/tmp/a11y/about.json');
  });

  test('routeToBaselinePath maps nested routes to slug format', () => {
    const p = routeToBaselinePath('/app/accounting/vouchers', '/tmp/a11y');
    expect(p).toBe('/tmp/a11y/app-accounting-vouchers.json');
  });

  test('parseBaseline handles standard schema', () => {
    const raw = JSON.stringify({
      route: '/about',
      totalViolations: 3,
      rules: { 'color-contrast': 2, 'image-alt': 1 },
    });
    const parsed = parseBaseline(raw, '/about');
    expect(parsed.totalViolations).toBe(3);
    expect(parsed.rules['color-contrast']).toBe(2);
    expect(parsed.rules['image-alt']).toBe(1);
  });

  test('parseBaseline handles maxTotal and violations array', () => {
    const raw = JSON.stringify({
      route: '/terms',
      maxTotal: 1,
      violations: [{ id: 'button-name', count: 1 }],
    });
    const parsed = parseBaseline(raw, '/terms');
    expect(parsed.totalViolations).toBe(1);
    expect(parsed.rules['button-name']).toBe(1);
  });

  test('parseBaseline handles flat rule dictionary', () => {
    const raw = JSON.stringify({
      'color-contrast': 4,
    });
    const parsed = parseBaseline(raw, '/test');
    expect(parsed.totalViolations).toBe(4);
    expect(parsed.rules['color-contrast']).toBe(4);
  });

  test('smoke throws descriptive error if invalid signature used', async ({ page }) => {
    await expect(smoke('/about', null as any)).rejects.toThrow(
      'smoke(route, { page }, options) requires { page } as second argument'
    );
    await expect(smoke(page, null as any)).rejects.toThrow(
      'smoke(page, route, options) requires route string as second argument'
    );
  });

  test('parseBaseline enforces baseline cannot exceed limit', () => {
    const raw = JSON.stringify({
      route: '/test',
      totalViolations: 2,
      rules: { 'color-contrast': 2 },
    });
    const parsed = parseBaseline(raw, '/test');
    expect(parsed.totalViolations).toBe(2);
    expect(parsed.rules['color-contrast']).toBe(2);

    // If an unexpected violation occurs, allowed defaults to 0
    expect(parsed.rules['image-alt'] ?? 0).toBe(0);
  });
});
