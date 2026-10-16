import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export interface OrgContext {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  role: string;
}

/**
 * The ONLY source of the tenant id for server code. Redirects to sign-in without a session,
 * and makes sure the user has an active organization (creating a personal team on first use).
 * Pass `organizationId` from here into repositories - never from request input.
 */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const h = await headers();

  let organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    const orgs = await auth.api.listOrganizations({ headers: h });
    let org = orgs[0];
    if (!org) {
      const created = await auth.api.createOrganization({
        body: {
          name: `${session.user.name || "My"} team`,
          slug: `team-${crypto.randomUUID().slice(0, 8)}`,
        },
        headers: h,
      });
      if (!created) throw new Error("could not create organization");
      org = created;
    }
    organizationId = org.id;
    await auth.api.setActiveOrganization({ body: { organizationId }, headers: h });
  }

  const active = await auth.api.getActiveMember({ headers: h });
  if (!active) throw new Error("not a member of the active organization");
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId,
    role: active.role,
  };
});
