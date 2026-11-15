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

/** transcribe() plus confidence. Primary provider first; if all its keys fail, the Smart Judge server STT. */
export async function transcribeDetailed(
  pcm16k: Int16Array,
  signal: AbortSignal,
  doFetch: typeof fetchProxied = fetchProxied,
): Promise<Transcript> {
  const wavBuf = wav(pcm16k, IN_RATE);
  if (cfg.sttProvider === 'smartjudge') {
    return { text: await smartjudgeStt(wavBuf, signal), logprob: null, provider: 'smartjudge' };
  }
  try {
    return await whisperStt(wavBuf, signal, doFetch);
  } catch (e) {
    if (signal.aborted || !(cfg.judgeGatewayKey || cfg.judgeToken)) throw e;
    // quota, outage or proxy down: the domestic server STT is slower but keeps the call alive
    const text = await smartjudgeStt(wavBuf, signal);
    return { text, logprob: null, provider: `smartjudge-fallback (${(e as Error).message.slice(0, 80)})` };
  }
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
