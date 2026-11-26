import * as assert from 'node:assert/strict';
import test from 'node:test';
import { buildAzureSsml, isEuAzureRegion, resolveAzureTtsEndpoint, streamAzureTtsPcm } from './azure-tts.js';
import { synthesizeStreamWithFallback } from './tts.js';

test('EU residency check allows EU Azure regions and rejects non-EU regions', () => {
  assert.equal(isEuAzureRegion('westeurope'), true);
  assert.equal(isEuAzureRegion('germanywestcentral'), true);
  assert.equal(isEuAzureRegion('eastus'), false);

  assert.equal(
    resolveAzureTtsEndpoint('westeurope', '', true),
    'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1',
  );
  assert.throws(() => resolveAzureTtsEndpoint('eastus', '', true), /EU residency/);
});

test('buildAzureSsml escapes XML special characters', () => {
  const ssml = buildAzureSsml('ماده ۱۰ & تبصره <۱>', 'fa-IR-FaridNeural', '+8%', '+0Hz');
  assert.match(ssml, /xml:lang="fa-IR"/);
  assert.match(ssml, /&amp;/);
  assert.match(ssml, /&lt;۱&gt;/);
});

test('streamAzureTtsPcm emits 10ms frames under 400ms on mocked raw PCM stream', async () => {
  // 50 ms of 48 kHz mono s16le = 4800 bytes
  const raw = Buffer.alloc(4800, 1);
  const mockFetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(raw.subarray(0, 2400));
          c.enqueue(raw.subarray(2400));
          c.close();
        },
      }),
      { status: 200 },
    );

  const chunks: Int16Array[] = [];
  const res = await streamAzureTtsPcm(
    'سلام',
    new AbortController().signal,
    (pcm) => chunks.push(pcm),
    mockFetch as never,
    { key: 'fake-key', region: 'westeurope', requireEu: true },
  );
  assert.equal(res.bytesReceived, 4800);
  assert.ok(res.firstAudioMs !== null && res.firstAudioMs < 400);
  assert.ok(chunks.length >= 1);
});

test('synthesizeStreamWithFallback automatically falls back to edge when azure fails', async () => {
  const emitted: Int16Array[] = [];
  let edgeCalled = false;
  const used = await synthesizeStreamWithFallback(
    'سلام',
    new AbortController().signal,
    (pcm) => emitted.push(pcm),
    {
      provider: 'azure',
      fallbackProvider: 'edge',
      azureRunner: async () => {
        throw new Error('azure tts 429: rate limited');
      },
      edgeRunner: async (_text, _sig, onPcm) => {
        edgeCalled = true;
        onPcm(new Int16Array(480));
      },
    },
  );
  assert.equal(edgeCalled, true);
  assert.equal(used.provider, 'edge');
  assert.equal(used.fellBack, true);
  assert.equal(emitted.length, 1);
});
