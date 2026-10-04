import { test, expect, type Page } from '@playwright/test';

// All API traffic is mocked via route interception: no real LLM calls.
const ROUTE = '**/api/judge/drafts/ruling';

const BANNER = 'پیش‌نویس غیررسمی و غیرقطعی تولیدشده با هوش مصنوعی؛ رأی دادگاه نیست.';

const OK_BODY = {
  status: 'AI_DRAFT_UNVERIFIED',
  banner: BANNER,
  requires_human_review: true,
  proposed_operative_part: 'پیشنهاد: محکومیت خوانده به پرداخت مبلغ مورد مطالبه.',
  articles: [{ law_name: 'قانون مدنی', article_no: '10' }],
  removed_citations: [{ law_name: 'قانون ناموجود', article_no: '1', reason: 'not_in_retrieved_set' }],
  missing_information: ['تاریخ دقیق قرارداد'],
  disclaimer: 'این متن صرفاً پیش‌نویس است.',
  draft_id: 'd-1',
  content_sha256: 'abc123',
};

async function fillForm(page: Page) {
  await page.goto('/draft-ruling');
  await page.getByLabel('نوع دادگاه').selectOption('civil');
  await page.getByLabel(/خواهان/).fill('علی');
  await page.getByLabel(/خوانده/).fill('رضا');
  await page.getByLabel(/شرح وقایع/).fill('وقایع پرونده');
  await page.getByLabel(/خواسته‌ها/).fill('مطالبه وجه');
}

test('success shows banner, status chip and sections', async ({ page }) => {
  await page.route(ROUTE, (r) => r.fulfill({ status: 200, json: OK_BODY }));
  await fillForm(page);
  await page.getByRole('button', { name: 'تهیه پیش‌نویس' }).click();
  await expect(page.getByTestId('non-binding-banner')).toContainText('غیرقطعی');
  await expect(page.getByTestId('status-chip')).toContainText('پیش‌نویس تأییدنشده');
  await expect(page.getByText('قانون مدنی ماده 10')).toBeVisible();
  await expect(page.getByText('قانون ناموجود ماده 1')).toBeVisible();
  await expect(page.getByText('تاریخ دقیق قرارداد')).toBeVisible();
});

test('insufficient basis still shows banner', async ({ page }) => {
  await page.route(ROUTE, (r) =>
    r.fulfill({
      status: 200,
      json: { ...OK_BODY, status: 'INSUFFICIENT_BASIS', proposed_operative_part: '', articles: [] },
    }),
  );
  await fillForm(page);
  await page.getByRole('button', { name: 'تهیه پیش‌نویس' }).click();
  await expect(page.getByTestId('non-binding-banner')).toBeVisible();
  await expect(page.getByTestId('status-chip')).toContainText('مبنای ناکافی');
});

test('403 VIP_REQUIRED shows upgrade message', async ({ page }) => {
  await page.route(ROUTE, (r) =>
    r.fulfill({ status: 403, json: { type: 'VIP_REQUIRED', message: 'x', action: 'UPGRADE_PLAN' } }),
  );
  await fillForm(page);
  await page.getByRole('button', { name: 'تهیه پیش‌نویس' }).click();
  await expect(page.getByRole('alert')).toContainText('VIP');
  await expect(page.getByRole('link', { name: 'ارتقای اشتراک' })).toBeVisible();
});

test('422 marks the offending field', async ({ page }) => {
  await page.route(ROUTE, (r) =>
    r.fulfill({
      status: 422,
      json: { detail: [{ loc: ['body', 'facts'], msg: 'too long', type: 'string_too_long' }] },
    }),
  );
  await fillForm(page);
  await page.getByRole('button', { name: 'تهیه پیش‌نویس' }).click();
  await expect(page.getByLabel(/شرح وقایع/)).toHaveAttribute('aria-invalid', 'true');
});

test('network failure offers retry that succeeds', async ({ page }) => {
  let calls = 0;
  await page.route(ROUTE, (r) => {
    calls += 1;
    return calls === 1 ? r.abort('failed') : r.fulfill({ status: 200, json: OK_BODY });
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'تهیه پیش‌نویس' }).click();
  await page.getByRole('button', { name: 'تلاش مجدد' }).click();
  await expect(page.getByTestId('non-binding-banner')).toBeVisible();
});

test('evidence repeater is capped at 20 items', async ({ page }) => {
  await page.goto('/draft-ruling');
  const add = page.getByRole('button', { name: 'افزودن دلیل' });
  for (let i = 0; i < 20; i++) await add.click();
  await expect(add).toBeDisabled();
});
