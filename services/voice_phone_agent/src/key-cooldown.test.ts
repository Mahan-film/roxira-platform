import assert from 'node:assert/strict';
import test from 'node:test';
import { Response } from 'undici';
import { cfg } from './config.js';
import { geminiCooldowns, geminiStt } from './stt.js';
import { KeyCooldowns } from './key-cooldown.js';

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'مهریه را چطور بگیرم؟' }] } }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } });
type F = typeof import('./http.js').fetchProxied;

const reset = () => (geminiCooldowns as unknown as { until: Map<string, number> }).until.clear();

test('KeyCooldowns skips a rested key until the cooldown ends, never returns zero keys', () => {
  let t = 1000;
  const c = new KeyCooldowns(() => t);
  const keys = ['a', 'b', 'c'];
  assert.deepEqual(c.order(keys, 1), ['b', 'c', 'a']);
  c.mark('b', 60_000);
  assert.deepEqual(c.order(keys, 1), ['c', 'a']);
  t += 59_999; assert.equal(c.isCooled('b'), true);
  t += 2; assert.deepEqual(c.order(keys, 1), ['b', 'c', 'a']);
  c.mark('a', 10_000); c.mark('b', 20_000); c.mark('c', 5_000);
  assert.deepEqual(c.order(keys, 0), ['c']); // all resting: the one back soonest
  assert.deepEqual(c.order([], 0), []);
});

for (const status of [401, 403, 429]) {
  test(`Gemini key answering ${status} is skipped for the cooldown, then retried`, async () => {
    const prev = { k: cfg.geminiKeys, ms: cfg.geminiKeyCooldownMs };
    cfg.geminiKeys = ['bad', 'good'];
    cfg.geminiKeyCooldownMs = 60_000;
    const used: string[] = [];
    const doFetch = (async (_u: unknown, init: { headers: Record<string, string> }) => {
      const k = init.headers['x-goog-api-key'];
      used.push(k);
      return k === 'bad' ? new Response('no', { status }) : ok();
    }) as unknown as F;
    const call = () => geminiStt(Buffer.alloc(8), new AbortController().signal, doFetch, 'm', 0);
    try {
      // the rotation cursor advances per call, so within 4 calls the bad key is tried first once and the pool rotates to the good one
      reset();
      for (let i = 0; i < 4 && !used.includes('bad'); i++) await call();
      assert.ok(used.includes('bad'), 'bad key was tried once');
      assert.equal(geminiCooldowns.isCooled('bad'), true);
      assert.equal(geminiCooldowns.isCooled('good'), false);
      used.length = 0;
      for (let i = 0; i < 5; i++) assert.equal(await call(), 'مهریه را چطور بگیرم؟');
      assert.deepEqual([...new Set(used)], ['good'], 'cooled key is not touched again');
    } finally {
      cfg.geminiKeys = prev.k; cfg.geminiKeyCooldownMs = prev.ms;
      reset();
    }
  });
}

test('Gemini 400 stops the rotation without resting the key; 503 rotates without resting', async () => {
  const prev = cfg.geminiKeys;
  cfg.geminiKeys = ['k1', 'k2'];
  try {
    let n = 0;
    const f400 = (async () => { n++; return new Response('bad', { status: 400 }); }) as unknown as F;
    await assert.rejects(geminiStt(Buffer.alloc(8), new AbortController().signal, f400, 'm', 0), /gemini stt 400/);
    assert.equal(n, 1);
    n = 0;
    const f503 = (async () => { n++; return new Response('down', { status: 503 }); }) as unknown as F;
    await assert.rejects(geminiStt(Buffer.alloc(8), new AbortController().signal, f503, 'm', 0), /gemini stt 503/);
    assert.equal(n, 2);
    assert.equal(geminiCooldowns.isCooled('k1') || geminiCooldowns.isCooled('k2'), false);
  } finally { cfg.geminiKeys = prev; }
});
