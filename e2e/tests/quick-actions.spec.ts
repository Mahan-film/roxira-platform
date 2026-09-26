import { test, expect } from '@playwright/test';

// W19: the owner reported "many buttons don't work". This is a no-cost smoke
// check that every quick-action / legal-drafting chip on the chat page is
// present, visible and enabled — it does NOT click them, because each click
// sends a real prompt to the live LLM (budgeted separately in chat.spec.ts).
const LEGAL_ACTION_LABELS = [
  'صدور لایحه دفاعیه',
  'صدور دادخواست حقوقی',
  'صدور شکواییه کیفری',
  'صدور اظهارنامه رسمی',
];

const QUICK_PROMPT_LABELS = [
  'استراتژی پرونده',
  'لایحه اعاده دادرسی',
  'صلاحیت دادگاه صلح ۱۴۰۲',
  'آرای وحدت رویه',
];

test('chat page renders every quick-action chip, enabled', async ({ page }) => {
  await page.goto('/chat');

  for (const label of [...LEGAL_ACTION_LABELS, ...QUICK_PROMPT_LABELS]) {
    const button = page.getByRole('button', { name: label });
    await expect(button, `missing/disabled chip: ${label}`).toBeVisible();
    await expect(button).toBeEnabled();
  }
});

test('mobile viewport: chat page renders every quick-action chip, enabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat');

  for (const label of [...LEGAL_ACTION_LABELS, ...QUICK_PROMPT_LABELS]) {
    const button = page.getByRole('button', { name: label });
    await expect(button, `missing/disabled chip: ${label}`).toBeVisible();
  }
});
