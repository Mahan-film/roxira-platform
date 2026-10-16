import "server-only";
import { auth } from "@/lib/auth";

export interface ApiKeyContext {
  userId: string;
  organizationId: string;
}

/**
 * Authenticate a public-API request by `Authorization: Bearer <key>` (or `x-api-key`).
 * The organization id comes from the key's metadata, stamped when the key was created
 * in settings - not from the request.
 */
export async function authenticateApiKey(req: Request): Promise<ApiKeyContext | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = bearer || req.headers.get("x-api-key");
  if (!key) return null;
  const res = await auth.api.verifyApiKey({ body: { key } });
  if (!res.valid || !res.key) return null;
  const meta = res.key.metadata as { organizationId?: string } | null;
  if (!meta?.organizationId) return null;
  return { userId: res.key.referenceId, organizationId: meta.organizationId };
}
