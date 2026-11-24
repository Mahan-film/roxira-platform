import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OUT_RATE, decodeTo48k, fadeEdges } from './audio.js';
import { streamAzureTtsPcm } from './azure-tts.js';
import { cfg } from './config.js';
import { fetchDirect, fetchProxied } from './http.js';
import { logger } from './log.js';

const log = logger('tts');

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
      body: JSON.stringify({ text, voice: cfg.ttsVoice, rate: cfg.ttsRate, pitch: cfg.ttsPitch }),
    });
  }
  if (!r.ok) throw new Error(`${cfg.ttsProvider} tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error(`${cfg.ttsProvider} tts returned ${buf.length} bytes`);
  return buf;
}

const FRAME_BYTES = 960; // 480 samples (10 ms @ 48 kHz) s16le
const TAIL_BYTES = FRAME_BYTES * 4; // held back so the last 40 ms can be faded

/**
 * Streaming synthesis: PCM reaches `onPcm` while the sentence is still being generated, always in
 * whole 10 ms frames (no zero-padded gaps between chunks). Only the edge sidecar streams; other
 * providers fall back to one chunk. Resolves when the sentence is complete.
 */
export async function synthesizeStream(
  text: string, signal: AbortSignal, onPcm: (pcm: Int16Array) => void,
): Promise<void> {
  await synthesizeStreamWithFallback(text, signal, onPcm);
}

export interface StreamFallbackOptions {
  provider?: 'edge' | 'openai' | 'smartjudge' | 'azure';
  fallbackProvider?: 'edge' | 'none';
  azureRunner?: (text: string, signal: AbortSignal, onPcm: (pcm: Int16Array) => void) => Promise<void>;
  edgeRunner?: (text: string, signal: AbortSignal, onPcm: (pcm: Int16Array) => void) => Promise<void>;
}

/**
 * Streaming synthesis with automatic edge-tts fallback when Azure Speech fails before emitting audio.
 */
export async function synthesizeStreamWithFallback(
  text: string,
  signal: AbortSignal,
  onPcm: (pcm: Int16Array) => void,
  opts?: StreamFallbackOptions,
): Promise<{ provider: string; fellBack: boolean }> {
  const provider = opts?.provider ?? cfg.ttsProvider;
  const fallback = opts?.fallbackProvider ?? cfg.ttsFallbackProvider;
  const runEdge = opts?.edgeRunner ?? streamEdgeTts;
  const runAzure = opts?.azureRunner ?? (async (t, sig, cb) => { await streamAzureTtsPcm(t, sig, cb); });

  if (provider === 'azure') {
    let emitted = false;
    try {
      await runAzure(text, signal, (pcm) => { emitted = true; onPcm(pcm); });
      return { provider: 'azure', fellBack: false };
    } catch (e) {
      if (signal.aborted || emitted || fallback !== 'edge') throw e;
      log.warn('tts.azure.fallback', { err: (e as Error).message.slice(0, 120) });
      await runEdge(text, signal, onPcm);
      return { provider: 'edge', fellBack: true };
    }
  }
  if (provider !== 'edge') {
    onPcm(await synthesize(text, signal));
    return { provider, fellBack: false };
  }
  await runEdge(text, signal, onPcm);
  return { provider: 'edge', fellBack: false };
}

async function streamEdgeTts(
  text: string, signal: AbortSignal, onPcm: (pcm: Int16Array) => void,
): Promise<void> {
  const r = await fetchDirect(`${cfg.edgeTtsUrl}/tts/stream`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: cfg.ttsVoice, rate: cfg.ttsRate, pitch: cfg.ttsPitch }),
  });
  if (!r.ok || !r.body) throw new Error(`edge tts stream ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0',
    '-fflags', 'nobuffer', '-f', 'mp3', '-i', 'pipe:0',
    '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', String(OUT_RATE), 'pipe:1'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  const onAbort = () => ff.kill('SIGKILL');
  signal.addEventListener('abort', onAbort, { once: true });

  let pending = Buffer.alloc(0);
  let first = true;
  const emit = (buf: Buffer, last: boolean) => {
    if (!buf.length) return;
    const pcm = new Int16Array(buf.length / 2);
    Buffer.from(pcm.buffer).set(buf);
    if (first) { fadeIn(pcm); first = false; }
    if (last) fadeOut(pcm);
    onPcm(pcm);
  };
  let err = '';
  ff.stderr.on('data', (b: Buffer) => { err += b.toString(); });
  ff.stdout.on('data', (b: Buffer) => {
    pending = Buffer.concat([pending, b]);
    const ready = Math.floor((pending.length - TAIL_BYTES) / FRAME_BYTES) * FRAME_BYTES;
    if (ready > 0) { emit(pending.subarray(0, ready), false); pending = pending.subarray(ready); }
  });
  const closed = new Promise<number | null>((res, rej) => { ff.on('close', res); ff.on('error', rej); });
  ff.stdin.on('error', () => { /* reported via close */ });

  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (signal.aborted) break;
      if (!ff.stdin.write(chunk)) await new Promise((res) => ff.stdin.once('drain', res));
    }
    ff.stdin.end();
    const code = await closed;
    if (signal.aborted) throw new Error('aborted');
    if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${err.slice(0, 200)}`);
    const whole = Math.ceil(pending.length / FRAME_BYTES) * FRAME_BYTES;
    const tail = Buffer.alloc(whole); // pads only the very last frame of the sentence
    pending.copy(tail);
    emit(tail, true);
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (ff.exitCode === null) ff.kill('SIGKILL');
  }
}

function fadeIn(pcm: Int16Array, ms = 8) {
  const n = Math.min(Math.floor((OUT_RATE * ms) / 1000), pcm.length);
  for (let i = 0; i < n; i++) pcm[i] = Math.round((pcm[i] * i) / n);
}
function fadeOut(pcm: Int16Array, ms = 8) {
  const n = Math.min(Math.floor((OUT_RATE * ms) / 1000), pcm.length);
  for (let i = 0; i < n; i++) pcm[pcm.length - 1 - i] = Math.round((pcm[pcm.length - 1 - i] * i) / n);
}

/**
 * Fixed prompts (greeting, filler, ...) are synthesized once and kept as raw PCM on disk,
 * keyed by provider+voice+rate+pitch+text, so answering a call costs zero synthesis latency.
 */
export async function cachedPrompt(text: string, fallbackWav?: string): Promise<Int16Array> {
  fs.mkdirSync(cfg.cacheDir, { recursive: true });
  const id = createHash('sha1').update(`${cfg.ttsProvider}|${cfg.ttsVoice}|${cfg.ttsRate}|${cfg.ttsPitch}|${text}`).digest('hex').slice(0, 16);
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
