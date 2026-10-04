/**
 * Mocked Playwright specs (no real backend). Requires @playwright/test, which is
 * not yet a dependency of this package; the hub must add it plus a config
 * (baseURL pointing at the Ghazi host) before these can run.
 */
import { expect, test } from "@playwright/test";

const API = "**/api/v1/apps/judge/drafts";

const SUGGEST = {
  suggestions: [
    { court_key: "criminal_2", court_name_fa: "دادگاه کیفری دو", stage: "trial", reason_fa: "اتهام جنحه است.", score: 0.8 },
    { court_key: "prosecution_investigator", court_name_fa: "دادسرا (بازپرس)", stage: "prosecution", reason_fa: "جرم مهم.", score: 0.5 },
    { court_key: "dispute_council", court_name_fa: "شورای حل اختلاف", stage: "council", reason_fa: "خواسته مالی اندک.", score: 0.4 },
  ],
  banner: "راهنما غیرقطعی است.",
  requires_human_review: true,
  disclaimer: "با وکیل تأیید کنید.",
  request_id: "req-1",
};

const INDICTMENT = {
  status: "AI_DRAFT_UNVERIFIED",
  banner: "این پیش‌نویس غیررسمی و غیرقطعی است.",
  requires_human_review: true,
  charge_description: "پیشنهاد (غیرقطعی): شرح اتهام نمونه",
  evidence_summary: "خلاصه ادله نمونه",
  legal_basis: [{ law_name: "قانون مجازات اسلامی", article_no: "1", reasoning: "دلیل نمونه" }],
  missing_information: ["تاریخ وقوع"],
  removed_citations: [],
  model_tier: "strong",
  request_id: "req-2",
  disclaimer: "سلب مسئولیت",
  draft_id: "d-1",
  content_sha256: "abc",
};

test.describe("/draft-ruling court step", () => {
  test("suggests courts and lets the user pick one", async ({ page }) => {
    await page.route(`${API}/court-suggest`, (r) => r.fulfill({ json: SUGGEST }));
    await page.goto("/draft-ruling");
    await expect(page.getByText("پرونده شما مربوط به کدام دادگاه است؟")).toBeVisible();
    // claims is optional: only facts are filled
    await page.locator("#suggest_facts").fill("وقایع");
    await page.getByRole("button", { name: "پیشنهاد دادگاه" }).click();
    await expect(page.getByTestId("suggest-guidance-note")).toContainText("با وکیل");
    await page.getByTestId("suggestion-criminal_2").click();
    await expect(page.locator("#court_type")).toHaveValue("criminal_2");
    // prosecution_* leads to the indictment page; dispute_council is guidance only
    await expect(page.getByTestId("suggestion-prosecution_investigator")).toHaveAttribute("href", "/draft-indictment");
    await expect(page.getByTestId("suggestion-dispute_council")).toContainText("فقط راهنمایی");
  });

  test("manual select offers the new court types", async ({ page }) => {
    await page.goto("/draft-ruling");
    await page.locator("#court_type").selectOption("bar_disciplinary");
    await expect(page.locator("#court_type")).toHaveValue("bar_disciplinary");
  });

  test("shows an error when court-suggest fails", async ({ page }) => {
    await page.route(`${API}/court-suggest`, (r) => r.abort());
    await page.goto("/draft-ruling");
    await page.locator("#suggest_facts").fill("وقایع");
    await page.locator("#suggest_claims").fill("خواسته");
    await page.getByRole("button", { name: "پیشنهاد دادگاه" }).click();
    await expect(page.getByRole("alert")).toContainText("ارتباط با سرور");
  });
});

test.describe("/draft-indictment", () => {
  async function fill(page: import("@playwright/test").Page) {
    await page.locator("#accused").fill("متهم");
    await page.locator("#complainant").fill("شاکی");
    await page.locator("#facts").fill("شرح وقایع");
  }

  test("submit is disabled until required fields are filled", async ({ page }) => {
    await page.goto("/draft-indictment");
    const submit = page.getByRole("button", { name: "تهیه پیش‌نویس" });
    await expect(submit).toBeDisabled();
    await fill(page);
    await expect(submit).toBeEnabled();
  });

  test("renders banner first, then sections", async ({ page }) => {
    await page.route(`${API}/indictment`, (r) => r.fulfill({ json: INDICTMENT }));
    await page.goto("/draft-indictment");
    await fill(page);
    await page.getByRole("button", { name: "تهیه پیش‌نویس" }).click();
    const result = page.locator("#result");
    await expect(result.getByTestId("non-binding-banner")).toBeVisible();
    const firstChild = result.locator("> div > *").first();
    await expect(firstChild).toHaveAttribute("data-testid", "non-binding-banner");
    await expect(result).toContainText("شرح اتهام نمونه");
    await expect(page.getByRole("button", { name: "کپی متن" })).toBeVisible();
    await expect(page.getByRole("button", { name: "دانلود txt" })).toBeVisible();
  });

  test("VIP required state", async ({ page }) => {
    await page.route(`${API}/indictment`, (r) =>
      r.fulfill({ status: 403, json: { type: "VIP_REQUIRED" } }),
    );
    await page.goto("/draft-indictment");
    await fill(page);
    await page.getByRole("button", { name: "تهیه پیش‌نویس" }).click();
    await expect(page.getByText("این امکان ویژه مشترکین VIP است.")).toBeVisible();
  });

  test("422 marks the offending field", async ({ page }) => {
    await page.route(`${API}/indictment`, (r) =>
      r.fulfill({ status: 422, json: { detail: [{ loc: ["body", "facts"], msg: "too short" }] } }),
    );
    await page.goto("/draft-indictment");
    await fill(page);
    await page.getByRole("button", { name: "تهیه پیش‌نویس" }).click();
    await expect(page.locator("#facts")).toHaveAttribute("aria-invalid", "true");
  });

  test("network failure offers retry", async ({ page }) => {
    await page.route(`${API}/indictment`, (r) => r.abort());
    await page.goto("/draft-indictment");
    await fill(page);
    await page.getByRole("button", { name: "تهیه پیش‌نویس" }).click();
    await expect(page.getByRole("button", { name: "تلاش مجدد" })).toBeVisible();
  });
});
