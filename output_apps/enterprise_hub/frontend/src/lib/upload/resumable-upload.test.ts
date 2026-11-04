import assert from "node:assert/strict";
import { test } from "node:test";

import { UploadHttpError, UploadPausedError, sha256Base64, uploadResumable } from "./resumable-upload.ts";
import type { PutPart, UploadStart, UploadTransport } from "./resumable-upload.ts";

const PART = 1024;

function fakeServer(over: Partial<UploadStart> = {}, totalParts = 0) {
  const stored = new Map<number, number>();
  const sums = new Map<number, string>();
  let lastSize = 0;
  const log = { signs: 0, relays: 0, completes: 0, starts: 0 };
  const caps = { direct: true, proxyParts: true, checksums: false, ...over };
  const transport: UploadTransport = {
    async start(file) {
      log.starts += 1;
      lastSize = file.size;
      return { jobId: "job-1", partBytes: PART, totalParts: Math.ceil(file.size / PART), ...caps };
    },
    async capabilities() {
      return caps;
    },
    async listParts() {
      return { partBytes: PART, totalParts: totalParts || Math.ceil(lastSize / PART), uploaded: [...stored].map(([partNumber, size]) => ({ partNumber, size })) };
    },
    async sign(_id, nums, checksums) {
      log.signs += 1;
      const urls: Record<string, string> = {};
      const headers: Record<string, Record<string, string>> = {};
      for (const n of nums) {
        urls[String(n)] = `https://r2.example/part/${n}`;
        if (checksums[String(n)]) headers[String(n)] = { "x-amz-checksum-sha256": checksums[String(n)] };
      }
      return { urls, headers };
    },
    async putViaApi(_id, n, body, headers) {
      log.relays += 1;
      stored.set(n, body.size);
      if (headers["x-amz-checksum-sha256"]) sums.set(n, headers["x-amz-checksum-sha256"]);
    },
    async complete() {
      log.completes += 1;
    },
  };
  return { transport, stored, sums, log };
}

const okPut = (stored: Map<number, number>, sums?: Map<number, string>): PutPart => async (url, body, headers, onBytes) => {
  const n = Number(url.split("/").pop());
  stored.set(n, body.size);
  if (headers["x-amz-checksum-sha256"]) sums?.set(n, headers["x-amz-checksum-sha256"]);
  onBytes(body.size);
};
const noSleep = async () => {};
const file = (size: number) => new File([new Uint8Array(size).fill(7)], "dump.sql");

test("uploads every part in parallel, reports progress and completes once", async () => {
  const { transport, stored, log } = fakeServer();
  const seen: number[] = [];
  const id = await uploadResumable(file(PART * 5 + 10), transport, { putPart: okPut(stored), sleep: noSleep, onProgress: (u) => seen.push(u) });
  assert.equal(id, "job-1");
  assert.equal(stored.size, 6);
  assert.equal(stored.get(6), 10);
  assert.equal(log.completes, 1);
  assert.equal(seen.at(-1), PART * 5 + 10);
});

test("resume sends only the parts storage does not hold (and re-sends a short one)", async () => {
  const { transport, stored, log } = fakeServer({}, 4);
  stored.set(1, PART);
  stored.set(2, PART);
  stored.set(3, 100); // truncated by a killed connection: must be re-sent
  const sent: number[] = [];
  const put: PutPart = async (url, body, h, onBytes) => {
    sent.push(Number(url.split("/").pop()));
    return okPut(stored)(url, body, h, onBytes);
  };
  await uploadResumable(file(PART * 4), transport, { resumeId: "job-1", putPart: put, sleep: noSleep, concurrency: 1 });
  assert.deepEqual(sent, [3, 4]);
  assert.equal(log.starts, 0, "resume must not create a second job");
  assert.equal(stored.get(3), PART);
});

test("retries a flaky network and surfaces UploadPausedError (with the job id) when it never recovers", async () => {
  const { transport, stored } = fakeServer({ proxyParts: false });
  let calls = 0;
  const flaky: PutPart = async (url, body, h, onBytes) => {
    calls += 1;
    if (calls <= 2) throw new TypeError("fetch failed");
    return okPut(stored)(url, body, h, onBytes);
  };
  await uploadResumable(file(PART), transport, { putPart: flaky, sleep: noSleep });
  assert.equal(calls, 3);
  const dead: PutPart = async () => {
    throw new TypeError("fetch failed");
  };
  const fresh = fakeServer({ proxyParts: false }).transport;
  await assert.rejects(uploadResumable(file(PART), fresh, { putPart: dead, sleep: noSleep, maxRetries: 2 }), (e: unknown) => e instanceof UploadPausedError && e.jobId === "job-1");
});

test("falls back to the API relay when storage is unreachable, and keeps going through it", async () => {
  const { transport, stored, log } = fakeServer();
  const dead: PutPart = async () => {
    throw new TypeError("fetch failed");
  };
  const events: string[] = [];
  await uploadResumable(file(PART * 4), transport, { putPart: dead, sleep: noSleep, concurrency: 2, onEvent: (e) => events.push(e.type) });
  assert.equal(stored.size, 4);
  assert.ok(log.relays >= 4);
  assert.ok(events.includes("fallback"));
});

test("a 403 from storage (bad signature, wrong digest) is not retried and does not trigger the fallback", async () => {
  const { transport, log } = fakeServer();
  let calls = 0;
  const denied: PutPart = async () => {
    calls += 1;
    throw new UploadHttpError(403);
  };
  await assert.rejects(uploadResumable(file(PART * 3), transport, { putPart: denied, sleep: noSleep, concurrency: 1 }), UploadHttpError);
  assert.equal(calls, 1);
  assert.equal(log.relays, 0);
});

test("sends the per-part SHA-256 on both paths when the server asks for it", async () => {
  const direct = fakeServer({ checksums: true });
  const expected = await sha256Base64(file(PART).slice(0, PART));
  assert.match(expected, /^[A-Za-z0-9+/]{43}=$/);
  await uploadResumable(file(PART * 2), direct.transport, { putPart: okPut(direct.stored, direct.sums), sleep: noSleep });
  assert.equal(direct.sums.get(1), expected);
  const relay = fakeServer({ checksums: true, direct: false });
  await uploadResumable(file(PART * 2), relay.transport, { sleep: noSleep });
  assert.equal(relay.sums.get(2), expected);
  assert.equal(relay.log.signs, 0, "a server without direct upload is never asked for signed URLs");
});

test("abort stops immediately and is not wrapped as a pause", async () => {
  const { transport } = fakeServer();
  const controller = new AbortController();
  const slow: PutPart = async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  };
  await assert.rejects(uploadResumable(file(PART * 3), transport, { putPart: slow, sleep: noSleep, signal: controller.signal }), (e: unknown) => e instanceof DOMException);
});
