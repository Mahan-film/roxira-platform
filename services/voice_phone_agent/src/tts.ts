import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeTo48k, fadeEdges } from './audio.js';
import { cfg } from './config.js';
import { fetchDirect, fetchProxied } from './http.js';

/** Persian text -> 48 kHz mono PCM. */
export async function synthesize(text: string, signal?: AbortSignal): Promise<Int16Array> {
  const encoded = await synthEncoded(text, signal);
  return fadeEdges(await decodeTo48k(encoded, signal));
}

async function synthEncoded(text: string, signal?: AbortSignal): Promise<Buffer> {
  let r;
  if (cfg.ttsProvider === 'openai') {
    if (!cfg.openaiKey) throw new Error('OPENAI_API_KEY is empty');
    r = await fetchProxied('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${cfg.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.openaiTtsModel, voice: cfg.openaiTtsVoice, input: text, response_format: 'mp3' }),
    });
  } else if (cfg.ttsProvider === 'smartjudge') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.judgeToken) headers.Authorization = `Bearer ${cfg.judgeToken}`;
    r = await fetchDirect(`${cfg.judgeBase}/speak`, { method: 'POST', signal, headers, body: JSON.stringify({ text }) });
  } else {
    // local edge-tts sidecar (tts_server.py); the sidecar itself goes out through the proxy
    r = await fetchDirect(`${cfg.edgeTtsUrl}/tts`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: cfg.ttsVoice, rate: cfg.ttsRate }),
    });
  }
  if (!r.ok) throw new Error(`${cfg.ttsProvider} tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error(`${cfg.ttsProvider} tts returned ${buf.length} bytes`);
  return buf;
}

/**
 * Fixed prompts (greeting, filler, ...) are synthesized once and kept as raw PCM on disk,
 * keyed by provider+voice+text, so answering a call costs zero synthesis latency.
 */
export async function cachedPrompt(text: string, fallbackWav?: string): Promise<Int16Array> {
  fs.mkdirSync(cfg.cacheDir, { recursive: true });
  const id = createHash('sha1').update(`${cfg.ttsProvider}|${cfg.ttsVoice}|${cfg.ttsRate}|${text}`).digest('hex').slice(0, 16);
  const file = path.join(cfg.cacheDir, `${id}.pcm`);
  if (fs.existsSync(file)) {
    const b = fs.readFileSync(file);
    return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2).slice();
  }
  try {
    const pcm = await synthesize(text);
    fs.writeFileSync(file, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    return pcm;
  } catch (e) {
    if (fallbackWav && fs.existsSync(fallbackWav)) {
      return decodeTo48k(fs.readFileSync(fallbackWav));
    }
    throw e;
  }
}
