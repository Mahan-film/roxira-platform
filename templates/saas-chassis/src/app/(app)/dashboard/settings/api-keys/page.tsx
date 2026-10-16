import { ApiKeyManager } from "@/components/api-key-manager";
import { listOrgApiKeys } from "@/lib/org-api-keys";
import { requireOrg } from "@/lib/tenant";

export default async function ApiKeysPage() {
  const org = await requireOrg();
  const keys = await listOrgApiKeys(org.organizationId);
  return (
    <ApiKeyManager
      canManage={org.role === "owner" || org.role === "admin"}
      keys={keys.map((k) => ({ id: k.id, name: k.name, start: k.start, createdAt: k.createdAt.toISOString() }))}
    />
  );
}
