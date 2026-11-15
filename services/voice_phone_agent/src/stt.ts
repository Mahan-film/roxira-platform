import { FormData } from 'undici';
import { IN_RATE, wav } from './audio.js';
import { cfg } from './config.js';
import { fetchDirect, fetchProxied } from './http.js';

function buildForm(wavBuf: Buffer, model?: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' }), 'utt.wav');
  if (model) {
    form.append('model', model);
    form.append('language', 'fa');
    form.append('temperature', '0');
    // verbose_json carries per-segment avg_logprob: the confidence gate in session.ts uses it
    form.append('response_format', 'verbose_json');
    if (cfg.sttPrompt) form.append('prompt', cfg.sttPrompt);
  }
  return form;
}

export interface Transcript {
  text: string;
  /** Duration-weighted Whisper avg_logprob (0 = certain); null when the provider gives none. */
  logprob: number | null;
  provider: string;
}

interface WhisperJson {
  text?: string;
  segments?: { start?: number; end?: number; avg_logprob?: number }[];
}

export function weightedLogprob(j: WhisperJson): number | null {
  let sum = 0;
  let dur = 0;
  for (const s of j.segments ?? []) {
    if (typeof s.avg_logprob !== 'number') continue;
    const d = Math.max(0.05, (s.end ?? 0) - (s.start ?? 0));
    sum += s.avg_logprob * d;
    dur += d;
  }
  return dur ? sum / dur : null;
}

/** Persian speech -> text. Returns '' when nothing intelligible was heard. */
export async function transcribe(
  pcm16k: Int16Array,
  signal: AbortSignal,
  doFetch: typeof fetchProxied = fetchProxied,
): Promise<string> {
  return (await transcribeDetailed(pcm16k, signal, doFetch)).text;
}

type Settled = { ok: true; text: string; model: string } | { ok: false; err: string; model: string };

const settle = (p: Promise<string>, model: string): Promise<Settled> =>
  p.then((text) => ({ ok: true as const, text, model }), (e) => ({ ok: false as const, err: (e as Error).message, model }));

/** First result with text among `ps`, or null once all failed/are empty or `ms` passed. */
function firstWithText(ps: Promise<Settled>[], ms: number): Promise<Settled | null> {
  return new Promise((resolve) => {
    let left = ps.length;
    const t = setTimeout(() => resolve(null), Math.max(0, ms));
    if (!left) { clearTimeout(t); resolve(null); }
    for (const p of ps) {
      void p.then((r) => {
        if (r.ok && r.text) { clearTimeout(t); resolve(r); }
        else if (--left === 0) { clearTimeout(t); resolve(null); }
      });
    }
  });
}

/**
 * transcribe() plus confidence.
 * hybrid (default when Gemini keys exist): Whisper and Gemini run in parallel. Whisper (~0.4 s) gives
 * avg_logprob, the gate for "real speech or noise" (Gemini invents plausible questions from noise);
 * Gemini's text is used when it arrives in time, because on real phone calls it hears Persian far
 * better (2026-11-15 call: Whisper "آخر آده رای بحث زدیه", Gemini "آخرین آرای وحدت رویه چی هستش").
 * Fallbacks when Whisper fails entirely: Gemini, then the Smart Judge server STT.
 */
export async function transcribeDetailed(
  pcm16k: Int16Array,
  signal: AbortSignal,
  doFetch: typeof fetchProxied = fetchProxied,
  /** called with Whisper's result as soon as it is in (before Gemini), e.g. to skip the filler on echo/noise */
  onWhisper?: (w: Transcript) => void,
): Promise<Transcript> {
  const wavBuf = wav(pcm16k, IN_RATE);
  if (cfg.sttProvider === 'smartjudge') {
    return { text: await smartjudgeStt(wavBuf, signal), logprob: null, provider: 'smartjudge' };
  }
  const t0 = Date.now();
  const gctl = new AbortController();
  const stop = () => gctl.abort();
  signal.addEventListener('abort', stop, { once: true });
  const hybrid = cfg.sttMode === 'hybrid' && cfg.geminiKeys.length > 0;
  // each model starts on a different key so parallel requests do not share one key's per-minute quota
  const gem = hybrid
    ? cfg.geminiSttModels.map((m, i) => settle(geminiStt(wavBuf, gctl.signal, doFetch, m, i), m))
    : [];
  try {
    let w: Transcript | null = null;
    let why = '';
    try {
      w = await whisperStt(wavBuf, signal, doFetch);
    } catch (e) {
      if (signal.aborted) throw e;
      why = (e as Error).message.slice(0, 80);
    }
    if (w) {
      onWhisper?.(w);
      // no speech, or Whisper unsure: the gate in session.ts decides (asks the caller to repeat)
      if (!hybrid || !w.text || (w.logprob !== null && w.logprob < cfg.sttMinLogprob)) return w;
      // the preferred model (all its parallel copies) up to GEMINI_WAIT_MS; then any backup that already answered
      const preferred = cfg.geminiSttModels[0];
      const isPref = (_: unknown, i: number) => cfg.geminiSttModels[i] === preferred;
      const best = (await firstWithText(gem.filter(isPref), t0 + cfg.geminiWaitMs - Date.now()))
        ?? (await firstWithText(gem.filter((p, i) => !isPref(p, i)), 50));
      if (!best || !best.ok) return w;
      return { text: best.text, logprob: w.logprob, provider: `gemini:${best.model}+whisper-gate` };
    }
    // Whisper down: Gemini alone (parallel calls already running, or started now), then Smart Judge
    const gs = gem.length ? gem : cfg.geminiKeys.length ? [settle(geminiStt(wavBuf, gctl.signal, doFetch, cfg.geminiSttModels[0], 0), cfg.geminiSttModels[0])] : [];
    const g = await firstWithText(gs, 8000);
    if (g && g.ok) return { text: g.text, logprob: null, provider: `gemini-fallback:${g.model} (${why})` };
    if (signal.aborted) throw new Error('aborted');
    if (!(cfg.judgeGatewayKey || cfg.judgeToken)) throw new Error(`stt failed: ${why}`);
    const text = await smartjudgeStt(wavBuf, signal);
    return { text, logprob: null, provider: `smartjudge-fallback (${why})` };
  } finally {
    gctl.abort(); // drop Gemini requests nobody waits for
    signal.removeEventListener('abort', stop);
  }
}

let geminiCursor = 0;

async function geminiStt(
  wavBuf: Buffer, signal: AbortSignal, doFetch: typeof fetchProxied, model: string, keyOffset: number,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [
      { text: cfg.geminiSttPrompt },
      { inline_data: { mime_type: 'audio/wav', data: wavBuf.toString('base64') } },
    ] }],
    generationConfig: { temperature: 0 },
  });
  let lastErr = '';
  const base = geminiCursor + keyOffset;
  geminiCursor = (geminiCursor + 1) % Math.max(1, cfg.geminiKeys.length);
  for (let i = 0; i < cfg.geminiKeys.length; i++) {
    const key = cfg.geminiKeys[(base + i) % cfg.geminiKeys.length];
    const r = await doFetch(url, {
      method: 'POST', body, signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    });
    if (r.ok) {
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return clean((j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''));
    }
    lastErr = `${r.status}`;
    if (r.status !== 429 && r.status !== 403 && r.status < 500) break;
  }
  throw new Error(`gemini stt ${lastErr}`);
}

async function smartjudgeStt(wavBuf: Buffer, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {};
  if (cfg.judgeToken) headers.Authorization = `Bearer ${cfg.judgeToken}`;
  if (cfg.judgeGatewayKey) headers['X-Phone-Gateway-Key'] = cfg.judgeGatewayKey;
  const r = await fetchDirect(`${cfg.judgeBase}/transcribe-audio`, {
    method: 'POST',
    body: buildForm(wavBuf),
    headers,
    signal,
  });
  const j = (await r.json().catch(() => ({}))) as { text?: string; message?: string };
  if (!r.ok) throw new Error(`smartjudge stt ${r.status}: ${j.message ?? ''}`);
  return clean(j.text ?? '');
}

async function whisperStt(wavBuf: Buffer, signal: AbortSignal, doFetch: typeof fetchProxied): Promise<Transcript> {
  const openai = cfg.sttProvider === 'openai';
  const keys = openai ? [cfg.openaiKey].filter(Boolean) : cfg.groqKeys;
  if (!keys.length) throw new Error(`${cfg.sttProvider.toUpperCase()}_API_KEY is empty`);
  const model = openai ? cfg.openaiSttModel : cfg.groqSttModel;
  const url = openai
    ? 'https://api.openai.com/v1/audio/transcriptions'
    : 'https://api.groq.com/openai/v1/audio/transcriptions';
  let lastErr = '';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(keyCursor + i) % keys.length];
    const r = await doFetch(url, {
      method: 'POST',
      body: buildForm(wavBuf, model),
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
    if (r.ok) {
      keyCursor = (keyCursor + i + 1) % keys.length; // spread load across keys
      const j = (await r.json()) as WhisperJson;
      const text = clean(j.text ?? '');
      return { text, logprob: text ? weightedLogprob(j) : null, provider: `${cfg.sttProvider}:${model}` };
    }
    lastErr = `${r.status}: ${(await r.text()).slice(0, 160)}`;
    if (r.status !== 429 && r.status !== 401 && r.status !== 403 && r.status < 500) break;
  }
  throw new Error(`${cfg.sttProvider} stt ${lastErr}`);
}

let keyCursor = 0;

// Whisper hallucinates these on silence/noise; treat as "nothing heard".
const HALLUCINATIONS = [/زیرنویس/, /امیدوارم از این ویدیو/, /لطفا سابسکرایب/, /^[\s.،؟!…]*$/];

function clean(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || HALLUCINATIONS.some((re) => re.test(s))) return '';
  // on near-silence Whisper may echo the vocabulary prompt back
  if (cfg.sttPrompt && s.length >= 12 && cfg.sttPrompt.includes(s.replace(/[.،]+$/, ''))) return '';
  return s;
}
