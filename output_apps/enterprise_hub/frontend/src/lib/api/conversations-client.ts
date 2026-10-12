/**
 * Client for the saved-chat endpoints (logged-in users only):
 *   GET  /api/v1/apps/judge/conversations                  -> { conversations: [{id, title, updated_at}] } (30 newest)
 *   GET  /api/v1/apps/judge/conversations/{id}/messages    -> { messages: [...], case_files: [{id, name, pages}] }
 * The server derives the owner from the Bearer token; there is no rename/delete endpoint.
 * No secrets here: the only credential is the user's own token (via authHeaders).
 */
import { authHeaders } from "@/lib/api/judge-chat-client";

export const CONVERSATIONS_PATH = "/api/v1/apps/judge/conversations";

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string | null;
}

export interface StoredMessage {
  role: "user" | "assistant";
  text: string;
  draft?: string | null;
  probability?: string | null;
}

export interface RestoredCaseFile {
  id: string;
  name: string;
  pages: number;
}

export interface StoredConversation {
  messages: StoredMessage[];
  caseFiles: RestoredCaseFile[];
}

export class ConversationsError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "SESSION_EXPIRED" : status === 404 ? "NOT_FOUND" : "FAILED");
    this.name = "ConversationsError";
  }
}

async function getJson(path: string, token: string | null | undefined, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(path, { headers: authHeaders(token), cache: "no-store", signal });
  } catch {
    throw new ConversationsError(0);
  }
  if (!res.ok) throw new ConversationsError(res.status);
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export async function listConversations(token: string | null | undefined, signal?: AbortSignal): Promise<ConversationSummary[]> {
  const body = await getJson(CONVERSATIONS_PATH, token, signal);
  const raw = Array.isArray(body.conversations) ? body.conversations : [];
  return raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      id: String(c.id ?? ""),
      title: typeof c.title === "string" ? c.title : "",
      updated_at: typeof c.updated_at === "string" ? c.updated_at : null,
    }))
    .filter((c) => c.id);
}

export async function loadConversation(id: string, token: string | null | undefined, signal?: AbortSignal): Promise<StoredConversation> {
  const body = await getJson(`${CONVERSATIONS_PATH}/${encodeURIComponent(id)}/messages`, token, signal);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages: StoredMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if ((r.role !== "user" && r.role !== "assistant") || typeof r.text !== "string") continue;
    messages.push({
      role: r.role,
      text: r.text,
      draft: typeof r.draft === "string" ? r.draft : null,
      probability: typeof r.probability === "string" ? r.probability : null,
    });
  }
  const rawFiles = Array.isArray(body.case_files) ? body.case_files : [];
  const caseFiles: RestoredCaseFile[] = [];
  for (const f of rawFiles.slice(0, 5)) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    caseFiles.push({ id: r.id, name: typeof r.name === "string" && r.name ? r.name : "پرونده", pages: Number(r.pages) || 0 });
  }
  return { messages, caseFiles };
}
