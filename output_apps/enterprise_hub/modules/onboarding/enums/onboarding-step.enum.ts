/** The steps of the new-company setup wizard, in the order the wizard shows them. */
export enum OnboardingStep {
  PROFILE = 'profile',
  FISCAL_YEAR = 'fiscal_year',
  CHART = 'chart',
  OPENING_BALANCES = 'opening_balances',
  USERS = 'users',
  MOADIAN = 'moadian',
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.PROFILE,
  OnboardingStep.FISCAL_YEAR,
  OnboardingStep.CHART,
  OnboardingStep.OPENING_BALANCES,
  OnboardingStep.USERS,
  OnboardingStep.MOADIAN,
];

/** What the client may record for a step. A step that was never touched is `pending`. */
export enum OnboardingStepStatus {
  PENDING = 'pending',
  DONE = 'done',
  SKIPPED = 'skipped',
}
