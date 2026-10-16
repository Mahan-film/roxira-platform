"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { priceIdFor, plans, type Interval, type PlanId } from "@config/plans";
import { auth } from "@/lib/auth";
import { getBilling } from "@/lib/billing";
import { assertWithinLimit, listOrgSubscriptions, PlanLimitError } from "@/lib/billing/subscriptions";
import { listOrgApiKeys } from "@/lib/org-api-keys";
import { requireOrg } from "@/lib/tenant";
import { trackServer } from "@/lib/track-server";
import { APP_URL } from "@/lib/utils";

export type ActionResult = { ok: true; secret?: string } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof PlanLimitError ? e.message : e instanceof Error ? e.message : "Something went wrong",
});

async function requireAdmin() {
  const org = await requireOrg();
  if (org.role !== "owner" && org.role !== "admin") throw new Error("Only owners and admins can do this");
  return org;
}

// ---- Team ----
const InviteInput = z.object({ email: z.string().trim().email(), role: z.enum(["member", "admin"]) });

export async function inviteMember(input: unknown): Promise<ActionResult> {
  try {
    const org = await requireAdmin();
    const data = InviteInput.parse(input);
    const full = await auth.api.getFullOrganization({ headers: await headers() });
    await assertWithinLimit(org.organizationId, "members", full?.members.length ?? 0);
    await auth.api.createInvitation({
      body: { email: data.email, role: data.role, organizationId: org.organizationId },
      headers: await headers(),
    });
    revalidatePath("/dashboard/settings/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- API keys (user-owned by Better Auth; we stamp + filter by organization) ----
const KeyInput = z.object({ name: z.string().trim().min(1).max(60) });

export async function createApiKey(input: unknown): Promise<ActionResult> {
  try {
    const org = await requireAdmin();
    const { name } = KeyInput.parse(input);
    const existing = await listOrgApiKeys(org.organizationId);
    await assertWithinLimit(org.organizationId, "apiKeys", existing.length);
    const created = await auth.api.createApiKey({
      body: { name, metadata: { organizationId: org.organizationId } },
      headers: await headers(),
    });
    revalidatePath("/dashboard/settings/api-keys");
    return { ok: true, secret: created.key }; // shown once; only a hash is stored
  } catch (e) {
    return fail(e);
  }
}

export async function deleteApiKey(keyId: string): Promise<ActionResult> {
  try {
    const org = await requireAdmin();
    const owned = (await listOrgApiKeys(org.organizationId)).some((k) => k.id === keyId);
    if (!owned) throw new Error("Not found");
    await auth.api.deleteApiKey({ body: { keyId }, headers: await headers() });
    revalidatePath("/dashboard/settings/api-keys");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- Billing ----
const CheckoutInput = z.object({
  planId: z.enum(plans.filter((p) => p.priceEnv).map((p) => p.id) as [PlanId, ...PlanId[]]),
  interval: z.enum(["month", "year"]),
});

export async function startCheckout(input: { planId: PlanId; interval: Interval }): Promise<ActionResult> {
  let url: string;
  try {
    const org = await requireAdmin();
    const data = CheckoutInput.parse(input);
    if (!priceIdFor(data.planId, data.interval)) throw new Error("This plan is not purchasable yet");
    await trackServer("checkout_started", { plan: data.planId });
    ({ url } = await getBilling().createCheckout({
      organizationId: org.organizationId,
      planId: data.planId,
      interval: data.interval,
      customerEmail: org.userEmail,
      successUrl: `${APP_URL}/dashboard/settings/billing`,
    }));
  } catch (e) {
    return fail(e);
  }
  redirect(url);
}

export async function openPortal(): Promise<ActionResult> {
  let url: string;
  try {
    const org = await requireAdmin();
    const customerId = (await listOrgSubscriptions(org.organizationId)).find(
      (s) => s.providerCustomerId,
    )?.providerCustomerId;
    if (!customerId) throw new Error("No billing account yet");
    url = await getBilling().customerPortalUrl(customerId);
  } catch (e) {
    return fail(e);
  }
  redirect(url);
}
