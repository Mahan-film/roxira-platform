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
    form.append('response_format', 'json');
    if (cfg.sttPrompt) form.append('prompt', cfg.sttPrompt);
  }
  return form;
}

/** Persian speech -> text. Returns '' when nothing intelligible was heard. */
export async function transcribe(
  pcm16k: Int16Array,
  signal: AbortSignal,
  doFetch: typeof fetchProxied = fetchProxied,
): Promise<string> {
  const wavBuf = wav(pcm16k, IN_RATE);

  if (cfg.sttProvider === 'smartjudge') {
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
      const j = (await r.json()) as { text?: string };
      return clean(j.text ?? '');
    }
    lastErr = `${r.status}: ${(await r.text()).slice(0, 160)}`;
    if (r.status !== 429 && r.status !== 401 && r.status < 500) break;
  }
  throw new Error(`${cfg.sttProvider} stt ${lastErr}`);
}

let keyCursor = 0;

// Whisper hallucinates these on silence/noise; treat as "nothing heard".
const HALLUCINATIONS = [/زیرنویس/, /امیدوارم از این ویدیو/, /لطفا سابسکرایب/, /^[\s.،؟!…]*$/];

function clean(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || HALLUCINATIONS.some((re) => re.test(s))) return '';
  return s;
}
