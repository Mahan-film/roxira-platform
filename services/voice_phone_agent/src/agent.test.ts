import assert from 'node:assert/strict';
import test from 'node:test';
import { FormData, Response } from 'undici';
import { cfg, validateConfig } from './config.js';
import { transcribe, weightedLogprob } from './stt.js';
import { looksIncomplete } from './turn.js';

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
