import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, TENANTS_RESOURCE_PATH } from "@/lib/api/config";
import type {
  OnboardingState,
  OnboardingStepKey,
  OnboardingStepStatus,
  SaveOnboardingProfileInput,
} from "@/types/onboarding";

// Same-origin proxy (next.config.ts rewrites); the browser never sees the backend address.
const ONBOARDING_ENDPOINT = `${API_PROXY_BASE_PATH}/${TENANTS_RESOURCE_PATH}/me/onboarding`;

/** Setup progress of the current organisation — GET /tenants/me/onboarding */
export const getOnboarding = (signal?: AbortSignal) =>
  apiRequest<OnboardingState>(ONBOARDING_ENDPOINT, { method: "GET", signal });

/** Step 1: name, economic code, national id — PUT /tenants/me/onboarding/profile */
export const saveOnboardingProfile = (body: SaveOnboardingProfileInput) =>
  apiRequest<OnboardingState>(`${ONBOARDING_ENDPOINT}/profile`, { method: "PUT", body });

/** Mark a step done or skipped, or reopen it — PUT /tenants/me/onboarding/steps/:step */
export const setOnboardingStep = (step: OnboardingStepKey, status: OnboardingStepStatus) =>
  apiRequest<OnboardingState>(`${ONBOARDING_ENDPOINT}/steps/${step}`, { method: "PUT", body: { status } });

/** Hide the dashboard banner / record the first-login redirect — PATCH /tenants/me/onboarding */
export const updateOnboarding = (body: { dismissed?: boolean; firstVisitHandled?: true }) =>
  apiRequest<OnboardingState>(ONBOARDING_ENDPOINT, { method: "PATCH", body });
