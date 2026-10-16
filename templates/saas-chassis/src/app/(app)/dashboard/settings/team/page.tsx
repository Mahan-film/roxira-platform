import { headers } from "next/headers";
import { InviteForm } from "@/components/invite-form";
import { auth } from "@/lib/auth";
import { requireOrg } from "@/lib/tenant";

export default async function TeamPage() {
  const org = await requireOrg();
  const full = await auth.api.getFullOrganization({ headers: await headers() });
  const canInvite = org.role === "owner" || org.role === "admin";

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {(full?.members ?? []).map((m) => (
          <li key={m.id} className="flex justify-between p-3">
            <span>
              {m.user.name} <span className="text-muted-foreground">({m.user.email})</span>
            </span>
            <span className="text-muted-foreground">{m.role}</span>
          </li>
        ))}
      </ul>
      {(full?.invitations ?? []).some((i) => i.status === "pending") && (
        <div className="text-sm">
          <h2 className="mb-1 font-semibold">Pending invitations</h2>
          <ul className="list-disc ps-5">
            {(full?.invitations ?? [])
              .filter((i) => i.status === "pending")
              .map((i) => (
                <li key={i.id}>{i.email}</li>
              ))}
          </ul>
        </div>
      )}
      {canInvite && <InviteForm />}
    </div>
  );
}
