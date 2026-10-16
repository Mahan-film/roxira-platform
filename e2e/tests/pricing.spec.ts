import { test, expect } from '@playwright/test';

// Read-only payment-path check. We deliberately do NOT call create-invoice:
// once a real gateway (Zibal) is wired in, a daily test would create real
// invoices. The pricing matrix is what the checkout page reads.
test('GET /api/v1/apps/judge/payments/pricing-matrix lists plans', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/v1/apps/judge/payments/pricing-matrix`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.status).toBe('SUCCESS');
  expect(body.plans).toBeTruthy();
  expect(Object.keys(body.plans).length).toBeGreaterThan(0);
});

// W19: the subscription modal (components/judge/subscription/subscription-modal.tsx)
// now reads its two real plan cards directly from this endpoint instead of a
// hardcoded, fabricated USD price. Lock in the plan keys/shape it depends on
// so a backend rename breaks CI instead of silently breaking the UI.
test('pricing matrix has the two real plan types the subscription UI wires up', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/v1/apps/judge/payments/pricing-matrix`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  for (const planType of ['SINGLE_DRAFT', 'VIP_MONTHLY_PRO']) {
    expect(body.plans[planType], `missing plan ${planType}`).toBeTruthy();
    expect(typeof body.plans[planType].price_toman).toBe('number');
    expect(body.plans[planType].price_toman).toBeGreaterThan(0);
  }
});

// PR #716 expanded the matrix with the 4-tier subscription model. The /plans
// page reads these SJ_* keys, so lock in their price shape and level so a
// backend rename or a pricing/level regression breaks CI instead of checkout.
const SUBSCRIPTION_TIERS = [
  { key: 'SJ_BASIC_MONTHLY', level: 'basic' },
  { key: 'SJ_BASIC_YEARLY', level: 'basic' },
  { key: 'SJ_PRO_MONTHLY', level: 'pro' },
  { key: 'SJ_PRO_YEARLY', level: 'pro' },
  { key: 'SJ_PREMIUM_MONTHLY', level: 'premium' },
  { key: 'SJ_PREMIUM_YEARLY', level: 'premium' },
];

test('pricing matrix has the 4-tier subscriptions from PR #716', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/v1/apps/judge/payments/pricing-matrix`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  for (const { key, level } of SUBSCRIPTION_TIERS) {
    const plan = body.plans[key];
    expect(plan, `missing plan ${key}`).toBeTruthy();
    expect(typeof plan.price_toman, `${key} price_toman`).toBe('number');
    expect(plan.price_toman, `${key} price_toman`).toBeGreaterThan(0);
    expect(plan.price_toman % 10_000, `${key} price_toman is a multiple of 10000`).toBe(0);
    expect(typeof plan.usd, `${key} usd`).toBe('number');
    expect(plan.usd, `${key} usd`).toBeGreaterThan(0);
    expect(plan.level, `${key} level`).toBe(level);
  }

  // Yearly = 12 months for the price of 10; the 10,000-Toman rounding keeps the
  // ratio within a narrow band around 10.
  for (const level of ['basic', 'pro', 'premium']) {
    const monthly = body.plans[`SJ_${level.toUpperCase()}_MONTHLY`].price_toman;
    const yearly = body.plans[`SJ_${level.toUpperCase()}_YEARLY`].price_toman;
    expect(yearly / monthly, `${level} yearly is ~10x monthly`).toBeGreaterThanOrEqual(9.5);
    expect(yearly / monthly, `${level} yearly is ~10x monthly`).toBeLessThanOrEqual(10.5);
  }
});

// The /plans page advertises the same four tiers the matrix prices; this keeps
// the visible tier names from silently drifting from the plan levels.
test('/plans shows the four subscription tier names', async ({ page }) => {
  const response = await page.goto('/plans');
  expect(response, 'no response received for /plans').not.toBeNull();
  expect(response!.status()).toBeLessThan(400);

  // toContainText with an array means one element per entry; check each name against the single body.
  for (const name of ['رایگان', 'پایه', 'حرفه‌ای', 'ویژه']) {
    await expect(page.locator('body')).toContainText(name);
  }
});
