import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ONBOARDING_STEPS,
  defaultFiscalYear,
  firstPendingStep,
  isValidEconomicCode,
  isValidNationalId,
  onboardingCounts,
  profileErrors,
  profilePayload,
  shouldRedirectToWizard,
  shouldShowBanner,
  toLatinDigits,
} from "./onboarding.ts";
import type { OnboardingStepKey, OnboardingStepStatus } from "../types/onboarding.ts";

function steps(overrides: Partial<Record<OnboardingStepKey, OnboardingStepStatus>> = {}) {
  const base = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.key, "pending"])) as Record<OnboardingStepKey, OnboardingStepStatus>;
  return { ...base, ...overrides };
}

test("the six steps are in the documented order", () => {
  assert.deepEqual(
    ONBOARDING_STEPS.map((s) => s.key),
    ["profile", "fiscal_year", "chart", "opening_balances", "users", "moadian"],
  );
});

test("counts treat done and skipped as finished", () => {
  const counts = onboardingCounts({ steps: steps({ profile: "done", chart: "skipped" }) });
  assert.deepEqual(counts, { total: 6, done: 1, skipped: 1, pending: 4, finished: 2 });
});

test("firstPendingStep resumes at the first step still waiting", () => {
  assert.equal(firstPendingStep({ steps: steps() }), "profile");
  assert.equal(firstPendingStep({ steps: steps({ profile: "done", fiscal_year: "skipped" }) }), "chart");
  const all = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.key, "done"])) as Record<OnboardingStepKey, OnboardingStepStatus>;
  assert.equal(firstPendingStep({ steps: all }), null);
});

test("banner shows to administrators until completed or dismissed", () => {
  assert.equal(shouldShowBanner({ completed: false, dismissed: false }, true), true);
  assert.equal(shouldShowBanner({ completed: true, dismissed: false }, true), false);
  assert.equal(shouldShowBanner({ completed: false, dismissed: true }, true), false);
  assert.equal(shouldShowBanner({ completed: false, dismissed: false }, false), false);
});

test("redirect fires only on the first visit of an empty organisation, for an administrator with accounting", () => {
  const ok = { isAdmin: true, hasAccounting: true, accountCount: 0 };
  assert.equal(shouldRedirectToWizard({ completed: false, firstVisit: true }, ok), true);
  assert.equal(shouldRedirectToWizard({ completed: false, firstVisit: false }, ok), false);
  assert.equal(shouldRedirectToWizard({ completed: true, firstVisit: true }, ok), false);
  assert.equal(shouldRedirectToWizard({ completed: false, firstVisit: true }, { ...ok, isAdmin: false }), false);
  assert.equal(shouldRedirectToWizard({ completed: false, firstVisit: true }, { ...ok, hasAccounting: false }), false);
  assert.equal(shouldRedirectToWizard({ completed: false, firstVisit: true }, { ...ok, accountCount: 3 }), false);
});

test("digits are normalised and the identifier rules match the server", () => {
  assert.equal(toLatinDigits("۴۱۱ ۲۳۴-۵۶۷۸۹۰"), "411234567890");
  assert.equal(toLatinDigits("١٠١٠١٢٣٤٥٦٧"), "10101234567");
  assert.equal(isValidEconomicCode("411234567890"), true);
  assert.equal(isValidEconomicCode("4112345678"), false);
  assert.equal(isValidEconomicCode("41123456789012345"), false);
  assert.equal(isValidEconomicCode("41123456789a"), false);
  assert.equal(isValidNationalId("1234567890"), true);
  assert.equal(isValidNationalId("10101234567"), true);
  assert.equal(isValidNationalId("123456789"), false);
});

test("profile form: name needed, identifiers optional but checked when filled", () => {
  assert.deepEqual(profileErrors({ name: "شرکت نمونه", economicCode: "", nationalId: "" }), {});
  assert.deepEqual(Object.keys(profileErrors({ name: " ", economicCode: "12", nationalId: "1" })).sort(), ["economicCode", "name", "nationalId"]);
});

test("profile payload drops empty identifiers and sends Latin digits", () => {
  assert.deepEqual(profilePayload({ name: "  شرکت  ", economicCode: "", nationalId: "" }), { name: "شرکت" });
  assert.deepEqual(profilePayload({ name: "شرکت", economicCode: "۴۱۱۲۳۴۵۶۷۸۹۰", nationalId: "۱۰۱۰۱۲۳۴۵۶۷" }), {
    name: "شرکت",
    economicCode: "411234567890",
    nationalId: "10101234567",
  });
});

test("default fiscal year is the Jalali year containing today", () => {
  // 1405 starts 2026-03-21 and ends 2027-03-20 (same dates as the API example).
  assert.deepEqual(defaultFiscalYear("2026-11-12"), { name: "1405", startDate: "2026-03-21", endDate: "2027-03-20" });
  assert.deepEqual(defaultFiscalYear("2026-03-21"), { name: "1405", startDate: "2026-03-21", endDate: "2027-03-20" });
  // 1403 is a leap year: Esfand has 30 days and ends on 2025-03-20.
  assert.deepEqual(defaultFiscalYear("2024-05-01"), { name: "1403", startDate: "2024-03-20", endDate: "2025-03-20" });
  assert.equal(defaultFiscalYear("not-a-date"), null);
});
