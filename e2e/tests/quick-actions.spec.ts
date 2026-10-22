import { test, expect, type Page } from '@playwright/test';

// W19: the owner reported "many buttons don't work". This is a no-cost smoke
// check that every quick-action / legal-drafting chip on the chat page is
// present, visible and enabled — it does NOT click them, because each click
// sends a real prompt to the live LLM (budgeted separately in chat.spec.ts).
//
// Issue #375: locators are scoped to their container. A bare
// getByRole('button', { name }) matched both a starter card and a chip, which
// breaks Playwright strict mode. Labels follow GUIDED_DRAFT_CHIPS and
// STARTER_GROUPS in output_apps/enterprise_hub/frontend/src/lib/chat-actions.ts.
const LEGAL_ACTION_LABELS = [
  'پیش‌نویس رأی',
  'کیفرخواست',
  'لایحه دفاعیه',
  'دادخواست حقوقی',
  'شکواییه کیفری',
  'اظهارنامه رسمی',
  'استراتژی حقوقی',
];

const STARTER_TITLES = [
  'مطالبه خسارت تأخیر تأدیه',
  'تخلیه ملک و پایان اجاره',
  'شکایت کیفری از کلاهبرداری',
  'اعاده دادرسی کیفری',
];

async function expectQuickActions(page: Page, checkEnabled: boolean) {
  const chips = page.getByRole('group', { name: 'اقدامات حقوقی' });
  for (const label of LEGAL_ACTION_LABELS) {
    const button = chips.getByRole('button', { name: label });
    await expect(button, `missing/disabled chip: ${label}`).toBeVisible();
    if (checkEnabled) await expect(button).toBeEnabled();
  }

  const starters = page.getByRole('region', { name: 'پرسش‌های نمونه' });
  for (const title of STARTER_TITLES) {
    const button = starters.getByRole('button', { name: title });
    await expect(button, `missing/disabled starter: ${title}`).toBeVisible();
    if (checkEnabled) await expect(button).toBeEnabled();
  }
}

test('chat page renders every quick-action chip, enabled', async ({ page }) => {
  await page.goto('/chat');
  await expectQuickActions(page, true);
});

test('mobile viewport: chat page renders every quick-action chip, enabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat');
  await expectQuickActions(page, false);
});
