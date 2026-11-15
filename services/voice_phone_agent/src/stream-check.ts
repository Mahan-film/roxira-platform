// Dev check: time to first PCM through the streaming TTS path, and the Smart Judge phone identity.
// `node dist/stream-check.js tts` measures TTS only (3 runs); otherwise judge + TTS of sentence 1.
import { askJudge } from './brain.js';
import { synthesizeStream } from './tts.js';

const ctl = new AbortController();

async function ttsOnce(s: string) {
  const t1 = Date.now();
  let firstPcm = 0, samples = 0;
  await synthesizeStream(s, ctl.signal, (pcm) => {
    if (!firstPcm) firstPcm = Date.now() - t1;
    samples += pcm.length;
    if (pcm.length % 480) throw new Error(`chunk not frame aligned: ${pcm.length}`);
  });
  return { firstPcm, done: Date.now() - t1, audio_s: +(samples / 48000).toFixed(2) };
}

if (process.argv[2] === 'tts') {
  for (let i = 0; i < 3; i++) console.log(await ttsOnce('مهلت تجدیدنظرخواهی برای اشخاص مقیم ایران بیست روز از تاریخ ابلاغ دادنامه است.'));
} else {
  const text = process.argv[2] ?? 'مهلت تجدیدنظرخواهی از احکام دادگاه چند روز است؟';
  const t0 = Date.now();
  let firstSentence = 0, n = 0, tts = {};
  for await (const s of askJudge(text, [], ctl.signal)) {
    if (!firstSentence) firstSentence = Date.now() - t0;
    if (n++ === 0) tts = await ttsOnce(s);
    console.log(`sentence ${n}: ${s.slice(0, 160)}`);
  }
  console.log({ first_sentence_ms: firstSentence, tts, total_ms: Date.now() - t0 });
}
