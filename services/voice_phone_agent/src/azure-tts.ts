import { OUT_RATE } from './audio.js';
import { cfg } from './config.js';
import { fetchProxied } from './http.js';

const FRAME_BYTES = 960; // 480 samples (10 ms @ 48 kHz) s16le
const TAIL_BYTES = FRAME_BYTES * 4;

const EU_AZURE_REGIONS = new Set([
  'westeurope',
  'northeurope',
  'germanywestcentral',
  'germanynorth',
  'francecentral',
  'francesouth',
  'swedencentral',
  'switzerlandnorth',
  'switzerlandwest',
  'italynorth',
  'polandcentral',
  'spaincentral',
  'austriaeast',
]);

export function isEuAzureRegion(region: string): boolean {
  return EU_AZURE_REGIONS.has(region.trim().toLowerCase());
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildAzureSsml(text: string, voice: string, rate: string, pitch: string): string {
  const langMatch = /^([a-z]{2}-[A-Z]{2})/.exec(voice);
  const lang = langMatch ? langMatch[1] : 'fa-IR';
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${escapeXml(voice)}">` +
    `<prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}">${escapeXml(text)}</prosody>` +
    '</voice></speak>'
  );
}

export function resolveAzureTtsEndpoint(region: string, overrideEndpoint = '', requireEu = true): string {
  const cleanRegion = region.trim().toLowerCase();
  if (requireEu && !isEuAzureRegion(cleanRegion)) {
    throw new Error(`azure tts region "${region}" failed EU residency check`);
  }
  if (overrideEndpoint.trim()) return overrideEndpoint.trim();
  return `https://${cleanRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function fadeIn(pcm: Int16Array, ms = 8) {
  const n = Math.min(Math.floor((OUT_RATE * ms) / 1000), pcm.length);
  for (let i = 0; i < n; i++) pcm[i] = Math.round((pcm[i] * i) / n);
}

function fadeOut(pcm: Int16Array, ms = 8) {
  const n = Math.min(Math.floor((OUT_RATE * ms) / 1000), pcm.length);
  for (let i = 0; i < n; i++) pcm[pcm.length - 1 - i] = Math.round((pcm[pcm.length - 1 - i] * i) / n);
}

export interface AzureStreamResult {
  firstAudioMs: number | null;
  bytesReceived: number;
}

/**
 * Stream raw 48 kHz 16-bit mono PCM directly from Azure Speech TTS (no ffmpeg decode overhead).
 */
export async function streamAzureTtsPcm(
  text: string,
  signal: AbortSignal,
  onPcm: (pcm: Int16Array) => void,
  doFetch: typeof fetchProxied = fetchProxied,
  opts?: {
    key?: string;
    region?: string;
    voice?: string;
    rate?: string;
    pitch?: string;
    endpoint?: string;
    requireEu?: boolean;
  },
): Promise<AzureStreamResult> {
  const key = opts?.key ?? cfg.azureSpeechKey;
  if (!key) throw new Error('AZURE_SPEECH_KEY is empty');
  const region = opts?.region ?? cfg.azureSpeechRegion;
  const requireEu = opts?.requireEu ?? cfg.ttsEuResidencyRequired;
  const url = resolveAzureTtsEndpoint(region, opts?.endpoint ?? cfg.azureTtsEndpoint, requireEu);
  const voice = opts?.voice ?? cfg.azureTtsVoice;
  const ssml = buildAzureSsml(text, voice, opts?.rate ?? cfg.ttsRate, opts?.pitch ?? cfg.ttsPitch);

  const t0 = Date.now();
  const r = await doFetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-48khz-16bit-mono-pcm',
      'User-Agent': 'roxira-voice-agent',
    },
    body: ssml,
  });
  if (!r.ok || !r.body) {
    throw new Error(`azure tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }

  let pending = Buffer.alloc(0);
  let first = true;
  let firstAudioMs: number | null = null;
  let bytesReceived = 0;

  const emit = (buf: Buffer, last: boolean) => {
    if (!buf.length) return;
    if (firstAudioMs === null) firstAudioMs = Date.now() - t0;
    const pcm = new Int16Array(buf.length / 2);
    Buffer.from(pcm.buffer).set(buf);
    if (first) { fadeIn(pcm); first = false; }
    if (last) fadeOut(pcm);
    onPcm(pcm);
  };

  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    if (signal.aborted) throw new Error('aborted');
    const b = Buffer.from(chunk);
    bytesReceived += b.length;
    pending = Buffer.concat([pending, b]);
    const ready = Math.floor((pending.length - TAIL_BYTES) / FRAME_BYTES) * FRAME_BYTES;
    if (ready > 0) {
      emit(pending.subarray(0, ready), false);
      pending = pending.subarray(ready);
    }
  }

  if (bytesReceived === 0) throw new Error('azure tts returned 0 bytes');
  const whole = Math.ceil(pending.length / FRAME_BYTES) * FRAME_BYTES;
  const tail = Buffer.alloc(whole);
  pending.copy(tail);
  emit(tail, true);

  return { firstAudioMs, bytesReceived };
}
