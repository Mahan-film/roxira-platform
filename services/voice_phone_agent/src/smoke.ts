/**
 * Offline pipeline check without a phone call:
 *   TTS(question) -> 16 kHz -> STT -> Smart Judge stream -> TTS(first sentence)
 * Usage: node dist/smoke.js "سؤال"
 */
import { spawnSync } from 'node:child_process';
import { askJudge, SentenceSplitter } from './brain.js';
import { cfg } from './config.js';
import { closeHttp } from './http.js';
import { transcribe } from './stt.js';
import { synthesize } from './tts.js';
import { EnergyVad } from './vad.js';

const q = process.argv[2] ?? 'مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی چقدر است؟';

// 1) splitter unit check
const sp = new SentenceSplitter();
const parts = [...sp.push('سلام. مهلت تجدیدنظر ۲۰ روز است؛ برای مقیم خارج ۲ ماه.\n1. نکته اول'), ...sp.flush()];
console.log('splitter:', parts);

const t0 = Date.now();
const q48 = await synthesize(q);
console.log(`tts(question): ${Date.now() - t0} ms, ${(q48.length / 48000).toFixed(1)} s audio`);

// 48k -> 16k by ffmpeg (same path the agent never needs: LiveKit resamples for us)
const raw = Buffer.from(q48.buffer, q48.byteOffset, q48.byteLength);
const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', 'pipe:1'], { input: raw });
const b = ff.stdout;
const pcm16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2).slice();

// 2) VAD check on the synthetic utterance (+1 s silence)
let utt = 0;
const vad = new EnergyVad({ onSpeechStart() {}, onBargeIn() {}, onUtterance(_p, ms) { utt = ms; } });
const padded = new Int16Array(pcm16.length + 16000); padded.set(pcm16);
for (let i = 0; i + 320 <= padded.length; i += 320) vad.push(padded.subarray(i, i + 320));
console.log(`vad: utterance ${utt ? Math.round(utt) + ' ms voiced' : 'NOT detected'}`);

const t1 = Date.now();
let text = q;
try {
  text = (await transcribe(pcm16, AbortSignal.timeout(20000))) || q;
  console.log(`stt(${cfg.sttProvider}): ${Date.now() - t1} ms -> ${text}`);
} catch (e) {
  console.log(`stt(${cfg.sttProvider}) FAILED: ${(e as Error).message} (using typed question)`);
}

const t2 = Date.now();
let n = 0;
for await (const s of askJudge(text, [], AbortSignal.timeout(60000))) {
  n++;
  if (n === 1) {
    console.log(`judge first sentence: ${Date.now() - t2} ms -> ${s}`);
    const t3 = Date.now();
    const a = await synthesize(s);
    console.log(`tts(first sentence): ${Date.now() - t3} ms, ${(a.length / 48000).toFixed(1)} s audio`);
    console.log(`=> first audio ready ${Date.now() - t1} ms after end of speech`);
  } else console.log(`judge sentence ${n}: ${s}`);
}
await closeHttp();
