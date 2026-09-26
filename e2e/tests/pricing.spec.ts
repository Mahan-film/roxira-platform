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
