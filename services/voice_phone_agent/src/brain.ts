import { cfg } from './config.js';
import { fetchDirect } from './http.js';

export interface Turn { role: 'user' | 'assistant'; content: string }

export class JudgeError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

/**
 * Streams the Smart Judge answer (SSE: meta -> delta* -> done | error) and yields complete
 * sentences as soon as they are available, so TTS can start on sentence 1.
 * Voice mode = short spoken answers and client-held history (server keeps the last 6 turns).
 */
export async function* askJudge(message: string, history: Turn[], signal: AbortSignal): AsyncGenerator<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (cfg.judgeToken) headers.Authorization = `Bearer ${cfg.judgeToken}`;
  if (cfg.judgeGatewayKey) headers['X-Phone-Gateway-Key'] = cfg.judgeGatewayKey;
  const timeout = AbortSignal.timeout(cfg.judgeTimeoutMs);
  const r = await fetchDirect(`${cfg.judgeBase}/chat/stream`, {
    method: 'POST', headers, signal: AbortSignal.any([signal, timeout]),
    body: JSON.stringify({ message, is_voice_mode: true, channel: 'voice', history: history.slice(-6) }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '');
    throw new JudgeError(r.status, t.slice(0, 300));
  }

  const splitter = new SentenceSplitter();
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk as Uint8Array, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const { event, data } = parseFrame(raw);
      if (event === 'delta') {
        for (const s of splitter.push(String(data?.content ?? ''))) yield s;
      } else if (event === 'error') {
        throw new JudgeError(500, String(data?.message ?? data?.code ?? 'stream error'));
      } else if (event === 'done') {
        for (const s of splitter.flush()) yield s;
        return;
      }
    }
  }
  for (const s of splitter.flush()) yield s;
}

function parseFrame(raw: string): { event: string; data: any } {
  let event = 'message';
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
  }
  try { return { event, data: JSON.parse(lines.join('\n')) }; } catch { return { event, data: null }; }
}

/** Buffers streamed tokens into speakable sentences. */
export class SentenceSplitter {
  private buf = '';
  private first = true;

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    // sentence end: . ! ? ؟ ؛ or newline, followed by whitespace/end. Skip "1." style list numbers.
    const re = /([.!?؟؛\n]+)(?=\s|$)/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      const piece = this.buf.slice(last, end);
      if (/^\s*\d{1,2}[.)]\s*$/.test(piece)) continue;
      // first sentence: speak early even if short; later ones: merge tiny fragments
      if (this.first || clean(piece).length >= 25) {
        const s = clean(piece);
        if (s) { out.push(s); this.first = false; }
        last = end;
      }
    }
    this.buf = this.buf.slice(last);
    // runaway sentence without punctuation: cut at a comma
    if (this.buf.length > 220) {
      const c = Math.max(this.buf.lastIndexOf('،', 200), this.buf.lastIndexOf(',', 200));
      if (c > 40) {
        const s = clean(this.buf.slice(0, c + 1));
        if (s) out.push(s);
        this.buf = this.buf.slice(c + 1);
      }
    }
    return out;
  }

  flush(): string[] {
    const s = clean(this.buf);
    this.buf = '';
    return s ? [s] : [];
  }
}

export function clean(t: string): string {
  return t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*#_`>|~]/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
