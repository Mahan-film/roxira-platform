import assert from 'node:assert/strict';
import test from 'node:test';
import { FormData, Response } from 'undici';
import { cfg, validateConfig } from './config.js';
import { LEGAL_VOCAB, repairLegalTerms } from './legal-terms.js';
import { clean, isPromptEcho, transcribe, transcribeDetailed, weightedLogprob } from './stt.js';
import { looksIncomplete, sameWord, stripEcho } from './turn.js';

// tests never reach a real provider: keys from the local key pool are dropped; tests set their own
cfg.geminiKeys = [];
cfg.judgeGatewayKey = '';
cfg.judgeToken = '';

const GREETING ='سلام، به سامانه هوشمند قاضی هوشمند خوش آمدید. لطفاً توجه داشته باشید که این پاسخ‌ها مشاوره اولیه است و جایگزین وکیل نیست. بفرمایید سوالتان چیست؟';

test('stripEcho removes the greeting heard back on the line (real call 2026-11-15)', () => {
  const cases: [string, string][] = [
    ['یکی به غازی حوشمند خوش آمدید. آخرین آرای وحدت رویه چی هستش؟', 'آخرین آرای وحدت رویه چی هستش؟'],
    ['به هوشمند قاضی هوشمند خوش آمدید. آخرین آرای وحدت رویه چی هستش؟', 'آخرین آرای وحدت رویه چی هستش؟'],
    ['یکی به قاضی هوشمند خوش آمدید آخر رای وحدت رویه چی هستش', 'آخر رای وحدت رویه چی هستش'],
    ['در اینجا یکی به غازی حوشمند خوش آمدید.', ''],
  ];
  for (const [inp, out] of cases) assert.equal(stripEcho(inp, [GREETING]).text, out, inp);
  // a real question that shares a word or two with the agent's speech stays intact
  for (const q of ['مهلت تجدیدنظرخواهی چند روز است؟', 'رأی وحدت رویه درباره مهریه چیست؟', 'سلام، یه سوال درباره چک برگشتی دارم']) {
    assert.equal(stripEcho(q, [GREETING, 'رأی وحدت رویه تصمیمی است که هیأت عمومی دیوان عالی کشور می‌گیرد.']).text, q, q);
  }
});

// Real call 2026-11-21: the caller barged in during this answer (first 300 characters, as logged)
// while the "one moment" filler was also recent. The old check removed the first half of the question.
const ANSWER_2026_11_21 = 'می‌توانم کمکتان کنم که سؤال حقوقی‌تان را روشن و دقیق مطرح کنید، و اگر مربوط به قانون باشد، '
  + 'توضیح بدهم چه مقرراتی و چه رویه‌ای می‌تواند به آن مربوط باشد. مثلا درباره نوشتن دادخواست، شکایت، پاسخ به '
  + 'اخطار یا درخواست تجدیدنظر، می‌توانم ساختار و نکات مهم هر متن را برایتان بگویم. اگر هم بخواهید، می‌توانم';

test('stripEcho keeps a caller question that only shares common words with the answer (real call 2026-11-21)', () => {
  const heard = 'الان توی یک درگیری اختیارمونی و یک درگیری که مثلا توی خونه هستش آیا قانون فرق می در محل اومده و یا در محل خصوصی؟';
  for (const agent of [[ANSWER_2026_11_21], [ANSWER_2026_11_21, 'بله، یک لحظه.'], [GREETING, ANSWER_2026_11_21, 'بله، یک لحظه.']]) {
    assert.deepEqual(stripEcho(heard, agent), { text: heard, removed: '' });
  }
  // a real echo of the same answer is still removed
  const echoed = 'توضیح بدهم چه مقرراتی و چه رویه‌ای می‌تواند به آن مربوط باشد. درگیری توی خونه با خیابون فرق داره؟';
  assert.equal(stripEcho(echoed, [ANSWER_2026_11_21, 'بله، یک لحظه.']).text, 'درگیری توی خونه با خیابون فرق داره؟');
});

test('sameWord tolerates STT misspellings but not different short words', () => {
  assert.ok(sameWord('حوشمند', 'هوشمند'));
  assert.ok(sameWord('يکی', 'یکی'));
  assert.ok(!sameWord('یه', 'به'));
  assert.ok(!sameWord('درگیری', 'دادخواست'));
});

test('repairLegalTerms fixes the misrecognitions of the real calls', () => {
  const cases: [string, string][] = [
    ['آخرین بخشنامه قول به غذایی چی بوده؟', 'آخرین بخشنامه قوه قضاییه چی بوده؟'],
    ['آخر آرای عدی بستا سویه چه بوده؟', 'آخرین آرای وحدت رویه چه بوده؟'],
    ['آخرین وعی چیز فرقی که ساده شده و آخرین قانون موردان برشویش چی ها بوده؟',
      'آخرین وعی چیز فرقی که ساده شده و آخرین قانون مبارزه با پولشویی چی ها بوده؟'],
    ['تخلافات دادگاه عالی انتظامی قضاک چی ها هستش؟', 'تخلفات دادگاه عالی انتظامی قضات چی ها هستش؟'],
    ['آخر آده رای بحث زدیه چی هستش؟', 'آخرین آرای وحدت رویه چی هستش؟'],
    ['آخر رای وحدت رویه چیه', 'آخرین رای وحدت رویه چیه'],
    ['سلام. آخر بخشنامه چی بوده؟', 'سلام. آخرین بخشنامه چی بوده؟'],
  ];
  for (const [inp, out] of cases) {
    assert.equal(repairLegalTerms(inp), out, inp);
    assert.equal(repairLegalTerms(out), out, `idempotent: ${out}`);
  }
  // correct or unrelated text is left alone
  for (const t of ['قوه قضاییه', 'مهلت تجدیدنظرخواهی چند روز است؟', 'در آخر رأی دادگاه نوشته شده که باید بپردازم',
    'آخر هفته دادگاه دارم', 'قانون مبارزه با پولشویی چه می‌گوید؟', 'به قول معروف غذا سرد شد']) {
    assert.equal(repairLegalTerms(t), t, t);
  }
});

test('STT prompt: carries the 2026-11-21 terms, stays short, and a single term is not a prompt echo', () => {
  for (const t of ['قوه قضاییه', 'آرای وحدت رویه', 'قانون مبارزه با پولشویی', 'دادگاه عالی انتظامی قضات', 'بخشنامه']) {
    assert.ok(cfg.sttPrompt.includes(t) || process.env.STT_PROMPT, t);
  }
  if (!process.env.STT_PROMPT) {
    assert.ok(cfg.sttPrompt.length <= 340, `prompt ${cfg.sttPrompt.length} chars`);
    assert.ok(cfg.sttPrompt.endsWith(`${LEGAL_VOCAB[LEGAL_VOCAB.length - 1]}.`));
  }
  const prompt = `پرسش حقوقی تلفنی: ${LEGAL_VOCAB.join('، ')}.`;
  assert.equal(isPromptEcho('قانون مبارزه با پولشویی', prompt), false);
  assert.equal(isPromptEcho('آخرین آرای وحدت رویه.', prompt), false);
  assert.equal(isPromptEcho('دادگاه عالی انتظامی قضات، قانون مبارزه با پولشویی', prompt), true);
  assert.equal(isPromptEcho('پرسش حقوقی تلفنی: دادنامه', prompt), true);
  // clean() keeps the caller's single term and repairs misheard ones
  assert.equal(clean('قانون مبارزه با پولشویی'), 'قانون مبارزه با پولشویی');
  assert.equal(clean('  قضاک  '), 'قضات');
});

test('looksIncomplete holds on unfinished Persian turns', () => {
  for (const t of ['سلام', 'یه سوال', 'صاحبخونه', 'سلام، من یه سوال داشتم در مورد', 'شوهرم مهریه‌ام رو', 'می‌خواستم بپرسم که',
    'در مورد چک برگشتی،', 'من کارگر بودم و', 'خب اممم']) {
    assert.equal(looksIncomplete(t), true, t);
  }
  for (const t of ['مهلت تجدیدنظرخواهی چند روز است؟', 'صاحبخانه می‌خواهد من را بیرون کند، چه کار کنم',
    'چک برگشتی دارم و می‌خواهم شکایت کنم.', 'خیلی ممنون']) {
    assert.equal(looksIncomplete(t), false, t);
  }
});

test('STT falls back to Gemini when every Groq key fails', async () => {
  const prev = { p: cfg.sttProvider, g: cfg.groqKeys, m: cfg.geminiKeys };
  cfg.sttProvider = 'groq';
  cfg.groqKeys = ['g1', 'g2'];
  cfg.geminiKeys = ['m1'];
  const urls: string[] = [];
  try {
    const out = await transcribe(new Int16Array(1600), new AbortController().signal, (async (url) => {
      urls.push(String(url));
      if (String(url).includes('groq')) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'مهریه را چطور بگیرم؟' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof import('./http.js').fetchProxied);
    assert.equal(out, 'مهریه را چطور بگیرم؟');
    assert.equal(urls.filter((u) => u.includes('groq')).length, 2);
    assert.ok(urls.some((u) => u.includes('generativelanguage')));
  } finally {
    cfg.sttProvider = prev.p; cfg.groqKeys = prev.g; cfg.geminiKeys = prev.m;
  }
});

function hybridFetch(whisper: object, gemini: string, geminiDelayMs = 0) {
  return (async (url: string) => {
    if (String(url).includes('groq')) {
      return new Response(JSON.stringify(whisper), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    await new Promise((r) => setTimeout(r, geminiDelayMs));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: gemini }] } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof import('./http.js').fetchProxied;
}

test('hybrid STT: Gemini text wins when Whisper is confident; Whisper gate rules on noise', async () => {
  const prev = { p: cfg.sttProvider, g: cfg.groqKeys, m: cfg.geminiKeys, mode: cfg.sttMode };
  cfg.sttProvider = 'groq'; cfg.groqKeys = ['g1']; cfg.geminiKeys = ['m1', 'm2']; cfg.sttMode = 'hybrid';
  const sig = new AbortController().signal;
  try {
    const good = { text: 'آخر آده رای بحث زدیه چی هستش؟', segments: [{ start: 0, end: 3, avg_logprob: -0.3 }] };
    const a = await transcribeDetailed(new Int16Array(1600), sig, hybridFetch(good, 'آخرین آرای وحدت رویه چی هستش؟'));
    assert.equal(a.text, 'آخرین آرای وحدت رویه چی هستش؟');
    assert.ok(a.provider.startsWith('gemini:'));
    const noise = { text: 'از اینجا باید برگشتی کنید.', segments: [{ start: 0, end: 3, avg_logprob: -0.9 }] };
    const b = await transcribeDetailed(new Int16Array(1600), sig, hybridFetch(noise, 'سلام، وقت بخیر، یه سوال حقوقی داشتم'));
    assert.equal(b.text, 'از اینجا باید برگشتی کنید.');
    assert.equal(b.logprob, -0.9);
    // Gemini too slow: Whisper text after GEMINI_WAIT_MS
    const prevWait = cfg.geminiWaitMs;
    cfg.geminiWaitMs = 150;
    const c = await transcribeDetailed(new Int16Array(1600), sig, hybridFetch(good, 'دیر', 600));
    cfg.geminiWaitMs = prevWait;
    // Whisper's own text, with the 2026-11-15 misrecognition repaired (legal-terms.ts)
    assert.equal(c.text, 'آخرین آرای وحدت رویه چی هستش؟');
  } finally {
    cfg.sttProvider = prev.p; cfg.groqKeys = prev.g; cfg.geminiKeys = prev.m; cfg.sttMode = prev.mode;
  }
});

test('weightedLogprob weights segments by duration', () => {
  assert.equal(weightedLogprob({}), null);
  const v = weightedLogprob({ segments: [{ start: 0, end: 3, avg_logprob: -0.1 }, { start: 3, end: 4, avg_logprob: -1.3 }] });
  assert.ok(v !== null && Math.abs(v - -0.4) < 1e-9);
});

test('validateConfig rejects empty LiveKit credentials', () => {
  assert.throws(
    () => validateConfig({ ...cfg, livekitKey: '', livekitSecret: '', judgeGatewayKey: 'k' }),
    /LIVEKIT_API_KEY/,
  );
});

test('validateConfig refuses the public LiveKit dev pair', () => {
  const pubKey = ['dev', 'key'].join('');
  const pubSecret = ['sec', 'ret'].join('');
  assert.throws(
    () => validateConfig({ ...cfg, livekitKey: pubKey, livekitSecret: pubSecret, judgeGatewayKey: 'gw-key' }),
    /dev pair/,
  );
  assert.doesNotThrow(() =>
    validateConfig({ ...cfg, livekitKey: 'APIgenerated1', livekitSecret: 'g'.repeat(40), judgeGatewayKey: 'gw-key' }),
  );
});

test('validateConfig fails closed when both gateway key and token are empty', () => {
  assert.throws(
    () => validateConfig({ ...cfg, livekitKey: 'lk-key', livekitSecret: 'lk-sec', judgeGatewayKey: '', judgeToken: '' }),
    /SMARTJUDGE_PHONE_GATEWAY_KEY/,
  );
  assert.doesNotThrow(() =>
    validateConfig({ ...cfg, livekitKey: 'lk-key', livekitSecret: 'lk-sec', judgeGatewayKey: 'gw-key', judgeToken: '' }),
  );
});

test('transcribe builds a fresh FormData on each key-rotation retry', async () => {
  const prevProvider = cfg.sttProvider;
  const prevKeys = cfg.groqKeys;
  cfg.sttProvider = 'groq';
  cfg.groqKeys = ['key-1', 'key-2'];
  const seenForms: unknown[] = [];
  const seenAuths: string[] = [];
  try {
    const pcm = new Int16Array(1600);
    const out = await transcribe(pcm, new AbortController().signal, (async (_url, init) => {
      seenForms.push(init?.body);
      seenAuths.push((init?.headers as Record<string, string>)?.Authorization ?? '');
      if (seenForms.length === 1) {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({ text: 'مهلت تجدیدنظر چند روز است؟' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof import('./http.js').fetchProxied);

    assert.equal(out, 'مهلت تجدیدنظر چند روز است؟');
    assert.equal(seenForms.length, 2);
    assert.notStrictEqual(seenForms[0], seenForms[1]);
    assert.ok(seenForms[1] instanceof FormData);
    assert.ok((seenForms[1] as FormData).get('file') instanceof Blob);
    assert.notEqual(seenAuths[0], seenAuths[1]);
  } finally {
    cfg.sttProvider = prevProvider;
    cfg.groqKeys = prevKeys;
  }
});
