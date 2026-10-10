/**
 * Client for `POST /api/v1/apps/judge/chat/stream` (SSE) with a `/chat` fallback.
 *
 * - Text arrives through `onDelta` as it is generated (first text typically < 2 s).
 * - If the stream cannot start (network error, timeout, 5xx, non-SSE reply) or breaks
 *   before the final `done` event, we fall back to `/chat` through the shared
 *   `fetchWithRetry` (retries network/502/503/504, waits while hidden/offline, sends
 *   client-error beacons) with the SAME request_id, so the server replays or joins the
 *   already running answer instead of recomputing it.
 * - A 503 `LLM_UNAVAILABLE` from the stream is final (the server already exhausted its model
 *   fallbacks) and its Persian message is surfaced as-is.
 */
import {
  CHAT_MAX_ATTEMPTS,
  CHAT_TIMEOUT_MS,
  JUDGE_CHAT_PATH,
  RetryTimeoutError,
  fetchWithRetry,
  hasAuthHeader,
  isStreamFailed,
  markStreamFailed,
  reportClientError,
  withoutAuthHeader,
} from "./judge-chat-client";

/** No byte from the stream within this time => give up on streaming and use /chat. */
export const STREAM_FIRST_BYTE_TIMEOUT_MS = 30_000;

export interface ChatDoneBody {
  status?: string;
  conversation_id?: string;
  reply?: string;
  response?: string;
  defense_draft?: string;
  success_probability?: string;
  statutory_basis?: unknown[];
  [key: string]: unknown;
}

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Incremental SSE parser: feed text chunks, get complete events back. */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try {
        events.push({ event, data: JSON.parse(dataLines.join("\n")) });
      } catch {
        /* ignore malformed frame */
      }
    }
    return events;
  };
}

export class ChatHttpError extends Error {
  status: number;
  body: { message?: string; code?: string } | null;
  constructor(status: number, body: { message?: string; code?: string } | null) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function readError(res: Response): Promise<ChatHttpError> {
  const body = await res.json().catch(() => null);
  return new ChatHttpError(res.status, body);
}

export interface StreamChatOptions {
  payload: Record<string, unknown> & { request_id: string };
  /** Auth header (and any other) shared by the stream and the fallback. */
  headers?: Record<string, string>;
  onDelta: (text: string) => void;
  /** Called when streamed text must be discarded because we switch to /chat. */
  onReset?: () => void;
  /** Called before each /chat fallback retry pause. */
  onRetry?: (attempt: number) => void;
  /**
   * Called once when the server answers 401 to a request that carried a token. The request is
   * then repeated ONCE without Authorization (anonymous FREE chat) with the same request_id.
   */
  onAuthExpired?: () => void;
  baseUrl?: string;
}

async function chatFallback(opts: StreamChatOptions): Promise<ChatDoneBody> {
  const base = opts.baseUrl ?? JUDGE_CHAT_PATH.replace(/\/chat$/, "");
  const res = await fetchWithRetry(
    `${base}/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": opts.payload.request_id,
        ...(opts.headers ?? {}),
      },
      body: JSON.stringify(opts.payload),
    },
    {
      maxAttempts: CHAT_MAX_ATTEMPTS,
      timeoutMs: CHAT_TIMEOUT_MS,
      retryOnGatewayStatus: true,
      requestId: opts.payload.request_id,
      onRetry: opts.onRetry,
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && typeof body === "object" && String((body as ChatDoneBody).status).toUpperCase() === "ERROR")) {
    throw new ChatHttpError(res.ok ? 400 : res.status, body);
  }
  return body as ChatDoneBody;
}

export async function streamChat(opts: StreamChatOptions): Promise<ChatDoneBody> {
  try {
    return await streamChatOnce(opts);
  } catch (e) {
    if (e instanceof ChatHttpError && e.status === 401 && hasAuthHeader(opts.headers)) {
      opts.onAuthExpired?.();
      opts.onReset?.();
      return streamChatOnce({ ...opts, headers: withoutAuthHeader(opts.headers) });
    }
    throw e;
  }
}

async function streamChatOnce(opts: StreamChatOptions): Promise<ChatDoneBody> {
  // Streaming already failed earlier in this session: go straight to /chat (with retries).
  if (isStreamFailed()) return chatFallback(opts);
  const base = opts.baseUrl ?? JUDGE_CHAT_PATH.replace(/\/chat$/, "");
  const requestId = opts.payload.request_id;
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STREAM_FIRST_BYTE_TIMEOUT_MS);
  let gotByte = false;
  try {
    const res = await fetch(`${base}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Idempotency-Key": requestId,
        ...(opts.headers ?? {}),
      },
      body: JSON.stringify(opts.payload),
      signal: controller.signal,
    });
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok) {
      const err = await readError(res);
      // Definitive answers (auth, limits, validation, LLM_UNAVAILABLE) are shown, not retried.
      const definitive =
        (res.status >= 400 && res.status < 500 && res.status !== 404) || err.body?.code === "LLM_UNAVAILABLE";
      if (definitive) throw Object.assign(err, { final: true });
      throw err;
    }
    if (!ctype.includes("text/event-stream") || !res.body) {
      const body = (await res.json().catch(() => null)) as ChatDoneBody | null;
      if (body && typeof body.reply === "string") return body;
      throw new Error("non-stream reply without answer");
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_FIRST_BYTE_TIMEOUT_MS);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser();
    let done: ChatDoneBody | null = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      if (!gotByte) {
        gotByte = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, CHAT_TIMEOUT_MS);
      }
      for (const ev of parse(decoder.decode(value, { stream: true }))) {
        const data = ev.data as Record<string, unknown>;
        if (ev.event === "delta" && typeof data.content === "string") opts.onDelta(data.content);
        else if (ev.event === "done") done = data as ChatDoneBody;
        else if (ev.event === "error") {
          throw Object.assign(new ChatHttpError(Number(data.status) || 503, data as { message?: string; code?: string }), {
            final: (data as { code?: string }).code === "LLM_UNAVAILABLE",
          });
        }
      }
    }
    if (done) return done;
    throw new Error("stream ended without done");
  } catch (e) {
    if ((e as { final?: boolean })?.final) throw e;
    reportClientError({
      kind: timedOut ? "stream-timeout" : e instanceof ChatHttpError ? "stream-http" : "stream-network",
      message: timedOut ? "timeout" : e instanceof Error ? `${e.name}: ${e.message}` : "stream failed",
      request_id: requestId,
      elapsed_ms: Date.now() - started,
    });
    // A network-level failure (not an HTTP answer) means streaming is unusable on this link.
    if (!(e instanceof ChatHttpError)) markStreamFailed();
    if (gotByte) opts.onReset?.();
    return chatFallback(opts);
  } finally {
    window.clearTimeout(timer);
  }
}

export { RetryTimeoutError };
