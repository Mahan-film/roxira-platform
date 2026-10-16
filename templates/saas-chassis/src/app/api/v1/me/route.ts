import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-auth";
import { getOrgPlan } from "@/lib/billing/subscriptions";

/** Example public-API endpoint secured by an organization API key. */
export async function GET(req: Request) {
  const ctx = await authenticateApiKey(req);
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const plan = await getOrgPlan(ctx.organizationId);
  return NextResponse.json({ organizationId: ctx.organizationId, plan: plan.id });
}
