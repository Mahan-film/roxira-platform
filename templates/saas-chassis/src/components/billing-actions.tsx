"use client";
import { useState } from "react";
import { openPortal, startCheckout } from "@/app/(app)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import type { PlanId } from "@config/plans";

interface PlanOption {
  id: PlanId;
  name: string;
  priceMonthly: number;
}

export function BillingActions({
  plans,
  currentPlanId,
  hasCustomer,
  canManage,
}: {
  plans: PlanOption[];
  currentPlanId: PlanId;
  hasCustomer: boolean;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!canManage) return <p className="text-sm text-muted-foreground">Only owners and admins manage billing.</p>;

  // A successful action redirects to the provider, so we only ever see the error case here.
  async function run(p: Promise<{ ok: boolean; error?: string } | undefined | void>) {
    const res = await p;
    if (res && !res.ok) setError(res.error ?? "Failed");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {plans.map((p) => (
          <Button
            key={p.id}
            variant={p.id === currentPlanId ? "outline" : "default"}
            disabled={p.id === currentPlanId}
            onClick={() => run(startCheckout({ planId: p.id, interval: "month" }))}
          >
            {p.id === currentPlanId ? `${p.name} (current)` : `Upgrade to ${p.name} - $${p.priceMonthly}/mo`}
          </Button>
        ))}
        {hasCustomer && (
          <Button variant="outline" onClick={() => run(openPortal())}>
            Manage billing
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
