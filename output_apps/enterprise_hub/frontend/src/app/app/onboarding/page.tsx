"use client";

import { ListChecks } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

/** First-login setup of a new company: six steps, each skippable, progress saved on the server. */
export default function OnboardingPage() {
  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="راه‌اندازی شرکت"
        description="مراحل آغاز کار را یکی‌یکی انجام دهید یا رد کنید؛ هر زمان می‌توانید به همین‌جا برگردید."
        icon={<ListChecks className="size-6 text-indigo-500" />}
      />
      <OnboardingWizard />
    </EnterpriseRouteGuard>
  );
}
