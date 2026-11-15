import { test } from '@playwright/test';
import { smoke } from '../../../helpers/smoke';

const PILOT_PUBLIC_ROUTES = [
  '/',
  '/about',
  '/services',
  '/contact',
  '/privacy',
  '/terms',
];

test.describe('Public pages smoke + axe pilot (T110)', () => {
  for (const route of PILOT_PUBLIC_ROUTES) {
    test(`smoke + axe for ${route}`, async ({ page }) => {
      await smoke(page, route);
    });
  }
});
