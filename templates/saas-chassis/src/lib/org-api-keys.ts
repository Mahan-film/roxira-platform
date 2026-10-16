import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export interface OrgApiKey {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
}

function orgIdOf(metadata: unknown): string | undefined {
  try {
    const m = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    return (m as { organizationId?: string } | null)?.organizationId;
  } catch {
    return undefined;
  }
}

/** API keys of the current user that were created for the given organization. */
export async function listOrgApiKeys(organizationId: string): Promise<OrgApiKey[]> {
  const res = (await auth.api.listApiKeys({ headers: await headers() })) as unknown;
  const all = (Array.isArray(res) ? res : ((res as { apiKeys?: unknown[] }).apiKeys ?? [])) as {
    id: string;
    name: string | null;
    start: string | null;
    createdAt: Date;
    metadata?: unknown;
  }[];
  return all
    .filter((k) => orgIdOf(k.metadata) === organizationId)
    .map((k) => ({ id: k.id, name: k.name, start: k.start, createdAt: new Date(k.createdAt) }));
}
