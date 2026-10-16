"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function OrgSwitcher({ activeId }: { activeId: string }) {
  const router = useRouter();
  const { data: orgs } = authClient.useListOrganizations();

  async function change(organizationId: string) {
    if (organizationId === "__new") {
      const name = window.prompt("Team name");
      if (!name) return;
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
      const created = await authClient.organization.create({ name, slug });
      if (created.data) await authClient.organization.setActive({ organizationId: created.data.id });
    } else {
      await authClient.organization.setActive({ organizationId });
    }
    router.refresh();
  }

  return (
    <select
      aria-label="Team"
      value={activeId}
      onChange={(e) => change(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
    >
      {(orgs ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
      <option value="__new">+ New team</option>
    </select>
  );
}
