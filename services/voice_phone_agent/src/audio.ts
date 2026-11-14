import { spawn } from 'node:child_process';

export const OUT_RATE = 48000;
export const IN_RATE = 16000;

export function rms(pcm: Int16Array): number {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

export function concat(chunks: Int16Array[]): Int16Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** 16-bit mono WAV container around raw PCM (for Whisper uploads). */
export function wav(pcm: Int16Array, rate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Any encoded audio (mp3/wav/opus) -> 48 kHz mono s16le via ffmpeg. */
export function decodeTo48k(input: Buffer, signal?: AbortSignal): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', String(OUT_RATE), 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const onAbort = () => ff.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    ff.stdout.on('data', (b: Buffer) => out.push(b));
    ff.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('aborted'));
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${err.slice(0, 200)}`));
      const buf = Buffer.concat(out);
      const copy = new Int16Array(Math.floor(buf.length / 2));
      Buffer.from(copy.buffer).set(buf.subarray(0, copy.length * 2));
      resolve(copy);
    });
    ff.stdin.on('error', () => { /* ffmpeg closed early; reported via close */ });
    ff.stdin.end(input);
  });
}

/** Short fades so cut sentences do not click on the phone line. */
export function fadeEdges(pcm: Int16Array, ms = 8): Int16Array {
  const n = Math.min(Math.floor((OUT_RATE * ms) / 1000), Math.floor(pcm.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    pcm[i] = Math.round(pcm[i] * g);
    pcm[pcm.length - 1 - i] = Math.round(pcm[pcm.length - 1 - i] * g);
  }
  return pcm;
}
