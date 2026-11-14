"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, X } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { Button } from "@/components/ui/button";
import { listAccounts } from "@/lib/api/accounting-client";
import { getOnboarding, updateOnboarding } from "@/lib/api/onboarding-client";
import { formatNumber } from "@/lib/fa-format";
import {
  ONBOARDING_HREF,
  onboardingCounts,
  shouldRedirectToWizard,
  shouldShowBanner,
} from "@/lib/onboarding";
import type { OnboardingState } from "@/types/onboarding";

/**
 * Dashboard entry to the setup wizard, for owners and admins only.
 *
 * - A brand-new organisation (first visit, no accounts yet) is sent to the wizard once; the visit is
 *   recorded on the server first, so it never redirects a second time, on any device.
 * - Otherwise a «complete setup» banner shows until every step is done or skipped, or it is dismissed.
 *
 * It is a convenience: if the status cannot be read, nothing is shown and the dashboard works as before.
 */
export function OnboardingBanner() {
  const router = useRouter();
  const { can, loading } = useAccess();
  const isAdmin = !loading && can("members", "admin");
  const hasAccounting = can("accounting");
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    (async () => {
      const loaded = await getOnboarding(controller.signal);
      if (!loaded.firstVisit) {
        setState(loaded);
        return;
      }
      const accountCount = hasAccounting ? (await listAccounts(controller.signal)).length : 0;
      const redirect = shouldRedirectToWizard(loaded, { isAdmin, hasAccounting, accountCount });
      // Record the visit before leaving, so the redirect happens once even if the wizard is abandoned.
      const recorded = await updateOnboarding({ firstVisitHandled: true });
      if (controller.signal.aborted) return;
      if (redirect) router.replace(ONBOARDING_HREF);
      else setState(recorded);
    })().catch(() => {
      /* optional banner: a failed read just hides it */
    });
    return () => controller.abort();
    // `can` is rebuilt with the access state; isAdmin/hasAccounting capture everything it contributes.
  }, [isAdmin, hasAccounting, router]);

  if (!state || !shouldShowBanner(state, isAdmin)) return null;
  const counts = onboardingCounts(state);

  const dismiss = async () => {
    try {
      setState(await updateOnboarding({ dismissed: true }));
    } catch {
      /* keep the banner; the user can try again */
    }
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-500/40 bg-indigo-500/10 p-4"
      role="region"
      aria-label="راه‌اندازی شرکت"
      data-testid="onboarding-banner"
    >
      <div className="flex items-center gap-3">
        <ListChecks className="size-6 shrink-0 text-indigo-400" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold">راه‌اندازی شرکت را کامل کنید</span>
          <span className="text-xs text-muted-foreground">
            {formatNumber(counts.finished)} از {formatNumber(counts.total)} مرحله انجام یا رد شده است.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={ONBOARDING_HREF} className="inline-flex h-8 items-center rounded-lg bg-indigo-500 px-3 text-sm font-medium text-white hover:bg-indigo-600" data-testid="onboarding-banner-link">
          ادامه راه‌اندازی
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={() => void dismiss()} aria-label="پنهان کردن یادآوری راه‌اندازی" data-testid="onboarding-banner-dismiss">
          <X className="size-4" aria-hidden="true" /> بعداً
        </Button>
      </div>
    </div>
  );
}
