import { test, expect } from '@playwright/test';

// Fixed Persian legal question. This is the ONLY test in the suite that
// triggers an LLM call — exactly one per run. Do not add more chat calls here
// or in other spec files.
const LEGAL_QUESTION = 'مهلت اعتراض به رای دادگاه بدوی در دعاوی حقوقی چند روز است؟';

test('POST /api/v1/apps/judge/chat answers a legal question', async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/api/v1/apps/judge/chat`, {
    data: { message: LEGAL_QUESTION },
    timeout: 60_000,
  });

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.status).toBe('SUCCESS');
  expect(typeof body.reply).toBe('string');
  expect(body.reply.trim().length).toBeGreaterThan(0);
});
