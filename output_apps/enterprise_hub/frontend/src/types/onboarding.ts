/**
 * Types of the new-company setup wizard. They mirror `OnboardingStateDto` in
 * `modules/onboarding/dto/onboarding.dto.ts` (GET /tenants/me/onboarding).
 */

export type OnboardingStepKey =
  | "profile"
  | "fiscal_year"
  | "chart"
  | "opening_balances"
  | "users"
  | "moadian";

export type OnboardingStepStatus = "pending" | "done" | "skipped";

export interface OnboardingState {
  steps: Record<OnboardingStepKey, OnboardingStepStatus>;
  /** Every step is done or skipped. */
  completed: boolean;
  /** The dashboard banner was dismissed. */
  dismissed: boolean;
  /** The first-login redirect has not been handled yet. */
  firstVisit: boolean;
  companyName: string;
  economicCode: string | null;
  nationalId: string | null;
}

export interface SaveOnboardingProfileInput {
  name: string;
  economicCode?: string;
  nationalId?: string;
}
