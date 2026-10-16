import { plans } from "@config/plans";
import { BillingActions } from "@/components/billing-actions";
import { getOrgPlan, listOrgSubscriptions } from "@/lib/billing/subscriptions";
import { requireOrg } from "@/lib/tenant";

export default async function BillingPage() {
  const org = await requireOrg();
  const [plan, subs] = await Promise.all([getOrgPlan(org.organizationId), listOrgSubscriptions(org.organizationId)]);
  const current = subs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <p>
          Current plan: <strong>{plan.name}</strong>
        </p>
        {current && (
          <p className="text-muted-foreground">
            Status: {current.status}
            {current.currentPeriodEnd && ` · period ends ${current.currentPeriodEnd.toISOString().slice(0, 10)}`}
            {current.cancelAtPeriodEnd && " · cancels at period end"}
          </p>
        )}
      </div>
      <BillingActions
        canManage={org.role === "owner" || org.role === "admin"}
        hasCustomer={!!current?.providerCustomerId}
        currentPlanId={plan.id}
        plans={plans.filter((p) => p.priceEnv).map((p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly }))}
      />
    </div>
  );
}
