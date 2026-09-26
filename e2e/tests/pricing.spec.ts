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
