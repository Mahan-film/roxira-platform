import "server-only";

/**
 * Client for an OpenAI-compatible gateway (our LiteLLM). Env only: AI_GATEWAY_URL,
 * AI_GATEWAY_KEY, AI_MODEL_GROUP (a gateway model-group name; real model ids live in the
 * gateway config, never here). Rendering AI output? Wrap it in <AiContent> (EU AI Act Art. 50).
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
}

function config() {
  const url = process.env.AI_GATEWAY_URL;
  const key = process.env.AI_GATEWAY_KEY;
  const model = process.env.AI_MODEL_GROUP;
  if (!url || !key || !model) throw new Error("AI_GATEWAY_URL / AI_GATEWAY_KEY / AI_MODEL_GROUP not set");
  return { url: url.replace(/\/$/, ""), key, model };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

async function post(messages: ChatMessage[], opts: ChatOptions, stream: boolean): Promise<Response> {
  const c = config();
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${c.url}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model ?? c.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream,
        }),
        // For streams the timeout covers time-to-headers only if we clear it; keep it simple:
        signal: AbortSignal.timeout(opts.timeoutMs ?? (stream ? 120_000 : 60_000)),
      });
      if (res.ok) return res;
      lastErr = new Error(`AI gateway error ${res.status}`);
      if (!retryable(res.status)) break;
    } catch (err) {
      lastErr = err; // network error or timeout: retry
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI gateway request failed");
}

/** One-shot completion; returns the assistant text. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const res = await post(messages, opts, false);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Streaming completion; yields text deltas as they arrive (SSE). */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const res = await post(messages, opts, true);
  if (!res.body) throw new Error("AI gateway returned no stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]
          ?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* ignore keep-alive / partial lines */
      }
    }
  }
}
