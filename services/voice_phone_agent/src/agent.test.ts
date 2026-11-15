import assert from 'node:assert/strict';
import test from 'node:test';
import { FormData, Response } from 'undici';
import { cfg, validateConfig } from './config.js';
import { transcribe, transcribeDetailed, weightedLogprob } from './stt.js';
import { looksIncomplete, stripEcho } from './turn.js';

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
    assert.equal(c.text, good.text);
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
