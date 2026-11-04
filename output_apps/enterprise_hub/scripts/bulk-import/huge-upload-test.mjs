#!/usr/bin/env node
/**
 * End-to-end test of the huge-upload path with NO real credentials: the real browser upload library
 * (frontend/src/lib/upload), the real BulkImportService and the real S3ObjectStore (AWS SDK, presigned URLs,
 * streamed relay) against an in-process S3/R2 mock that checks the per-part SHA-256 and discards the bytes.
 *
 *   npx tsc -p output_apps/enterprise_hub/tsconfig.json --outDir $DIST --noEmit false
 *   node output_apps/enterprise_hub/scripts/bulk-import/huge-upload-test.mjs --dist $DIST [--gib 2] [--keep]
 *
 * Scenarios: A direct (presigned PUT, parallel, checksums) · B kill the connection at ~40 % then resume ·
 * C relay through the API (streamed, RSS sampled) · D storage unreachable -> automatic fallback to the relay.
 * Prints one JSON line per scenario with MB/s. Nothing but the synthetic file touches disk.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const DIST = path.resolve(opt('dist', ''));
const GIB = Number(opt('gib', '2'));
const KEEP = args.includes('--keep');
const here = path.dirname(fileURLToPath(import.meta.url));
const libUrl = pathToFileURL(path.resolve(here, '../../frontend/src/lib/upload/resumable-upload.ts')).href;
const T = '11111111-1111-4111-8111-111111111111';
const MiB = 1024 * 1024;

process.env.IMPORT_STORAGE_DRIVER = 's3';
process.env.IMPORT_PART_CHECKSUMS = '1';
process.env.IMPORT_PART_BYTES = String(64 * MiB);

const require = (await import('node:module')).createRequire(import.meta.url);
const { BulkImportService } = require(path.join(DIST, 'modules/data_import/bulk/bulk-import.service.js'));
const { S3ObjectStore } = require(path.join(DIST, 'modules/data_import/bulk/storage/s3-object-store.js'));
const { uploadResumable } = await import(libUrl);

// ---------- in-process R2 mock (path-style S3) ----------
function startMockR2() {
  const uploads = new Map(); // uploadId -> Map(part -> {size, etag, sha})
  const stats = { bytes: 0, badDigest: 0, parts: 0, sockets: new Set() };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    const done = (code, body = '', headers = {}) => { res.writeHead(code, { 'content-type': 'application/xml', ...headers }); res.end(body); };
    if (req.method === 'POST' && q.has('uploads')) {
      const id = `up-${uploads.size + 1}`;
      uploads.set(id, new Map());
      return done(200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'PUT' && q.get('partNumber')) {
      const parts = uploads.get(q.get('uploadId'));
      const n = Number(q.get('partNumber'));
      const hash = createHash('sha256');
      let size = 0;
      req.on('data', (c) => { size += c.length; hash.update(c); });
      req.on('aborted', () => {});
      req.on('end', () => {
        const sha = hash.digest('base64');
        const want = req.headers['x-amz-checksum-sha256'];
        if (want && want !== sha) { stats.badDigest += 1; return done(400, '<Error><Code>BadDigest</Code></Error>'); }
        parts.set(n, { size, etag: `"${sha.slice(0, 8)}-${n}"` });
        stats.bytes += size; stats.parts += 1;
        done(200, '', { etag: `"${sha.slice(0, 8)}-${n}"` });
      });
      return;
    }
    if (req.method === 'GET' && q.has('uploadId')) {
      const parts = uploads.get(q.get('uploadId')) ?? new Map();
      const xml = [...parts].sort((a, b) => a[0] - b[0]).map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><Size>${p.size}</Size><ETag>${p.etag}</ETag></Part>`).join('');
      return done(200, `<ListPartsResult><IsTruncated>false</IsTruncated>${xml}</ListPartsResult>`);
    }
    if (req.method === 'POST' && q.has('uploadId')) {
      req.resume();
      return req.on('end', () => done(200, '<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>'));
    }
    if (req.method === 'HEAD') {
      let total = 0;
      for (const parts of uploads.values()) for (const p of parts.values()) total += p.size;
      return done(200, '', { 'content-length': String(total / [...uploads.values()].length || 0) });
    }
    done(204);
  });
  server.on('connection', (s) => { stats.sockets.add(s); s.on('close', () => stats.sockets.delete(s)); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, stats, uploads, port: server.address().port })));
}

// ---------- in-memory repo + queue (same shape the unit tests use) ----------
function makeService(store) {
  const jobs = new Map();
  const repo = {
    usedBytes: async () => 0, countActive: async () => 0,
    createJob: async (_t, j) => { const job = { ...j, tenantId: T, status: 'uploading', tables: [], notes: [], checkpoint: {}, bytesRead: 0, rowsStaged: 0, sourceRemoved: false, rowsRemoved: false, review: null, postProgress: null, batchId: null, error: null, attempts: 0 }; jobs.set(j.id, job); return job; },
    getJob: async (_t, id) => jobs.get(id) ?? null,
    update: async (_t, id, patch) => void Object.assign(jobs.get(id), patch),
  };
  return { svc: new BulkImportService(repo, store, { add: async () => undefined }), jobs };
}

// ---------- API server mirroring BulkImportController ----------
function startApi(svc) {
  const json = async (req) => { const c = []; for await (const b of req) c.push(b); return c.length ? JSON.parse(Buffer.concat(c)) : {}; };
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const u = req.url.split('?')[0];
      let m;
      if (req.method === 'POST' && u === '/uploads') { const b = await json(req); return reply(201, await svc.startUpload(T, 'u', { fileName: b.fileName, size: b.size })); }
      if ((m = u.match(/^\/uploads\/([^/]+)\/parts$/)) && req.method === 'GET') return reply(200, await svc.uploadedParts(T, m[1]));
      if ((m = u.match(/^\/uploads\/([^/]+)\/sign$/))) { const b = await json(req); return reply(200, await svc.signParts(T, m[1], b.partNumbers, b.checksums)); }
      if ((m = u.match(/^\/uploads\/([^/]+)\/parts\/(\d+)$/)) && req.method === 'PUT') {
        const len = req.headers['content-length']; const sum = req.headers['x-amz-checksum-sha256'];
        return reply(200, await svc.putProxyPart(T, m[1], Number(m[2]), req, len === undefined ? null : Number(len), typeof sum === 'string' ? sum : undefined));
      }
      if ((m = u.match(/^\/uploads\/([^/]+)\/complete$/))) { return reply(202, await svc.completeUpload(T, m[1])); }
      if (u === '/config') return reply(200, svc.config());
      reply(404, {});
    } catch (e) { reply(e.getStatus?.() ?? 500, { message: String(e.message) }); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function transportFor(base) {
  const j = async (p, init) => { const r = await fetch(base + p, init); const t = await r.json(); if (!r.ok) { const e = new Error(t.message); e.statusCode = r.status; throw e; } return t; };
  const post = (p, body, signal) => j(p, { method: 'POST', body: JSON.stringify(body), signal });
  return {
    start: (f, signal) => post('/uploads', { fileName: f.name, size: f.size }, signal),
    capabilities: async (signal) => { const c = await j('/config', { signal }); return { direct: c.direct, proxyParts: c.proxyParts, checksums: c.checksums }; },
    listParts: (id, signal) => j(`/uploads/${id}/parts`, { signal }),
    sign: (id, partNumbers, checksums, signal) => post(`/uploads/${id}/sign`, { partNumbers, checksums }, signal),
    putViaApi: async (id, n, body, headers, signal) => { await j(`/uploads/${id}/parts/${n}`, { method: 'PUT', body, headers, signal, duplex: 'half' }); },
    complete: async (id, signal) => { await post(`/uploads/${id}/complete`, {}, signal); },
  };
}

// ---------- synthetic file ----------
const file = path.join(os.tmpdir(), `huge-${GIB}g.bin`);
if (!fs.existsSync(file) || fs.statSync(file).size !== GIB * 1024 * MiB) {
  const chunk = Buffer.alloc(8 * MiB);
  for (let i = 0; i < chunk.length; i += 4) chunk.writeUInt32LE((i * 2654435761) >>> 0, i);
  const fd = fs.openSync(file, 'w');
  for (let w = 0; w < (GIB * 1024) / 8; w += 1) { chunk.writeUInt32LE(w, 0); fs.writeSync(fd, chunk); }
  fs.closeSync(fd);
}
const blob = await fs.openAsBlob(file);
Object.defineProperty(blob, 'name', { value: `huge-${GIB}g.sql` });
const SIZE = blob.size;

// ---------- RSS sampler ----------
function sampler() { let peak = 0; const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50); return () => { clearInterval(t); return Math.round(peak / MiB); }; }
const out = (o) => console.log(JSON.stringify(o));

async function setup() {
  const r2 = await startMockR2();
  const store = new S3ObjectStore({ endpoint: `http://127.0.0.1:${r2.port}`, accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'imports' });
  const { svc, jobs } = makeService(store);
  const api = await startApi(svc);
  return { r2, svc, jobs, api, transport: transportFor(`http://127.0.0.1:${api.port}`) };
}
async function timed(label, fn, extra = () => ({})) {
  const stop = sampler(); const t0 = performance.now();
  const result = await fn();
  const secs = (performance.now() - t0) / 1000;
  out({ scenario: label, gib: GIB, seconds: +secs.toFixed(1), mbPerSec: +(SIZE / MiB / secs).toFixed(0), peakRssMiB: stop(), ...extra(result) });
  return result;
}

let failed = false;
const check = (ok, msg) => { if (!ok) { failed = true; console.error('FAIL:', msg); } };

// A: direct + checksums
{
  const env = await setup();
  const events = [];
  await timed('A-direct-presigned-parallel', () => uploadResumable(blob, env.transport, { concurrency: 4, onEvent: (e) => events.push(e.type) }),
    () => ({ parts: env.r2.stats.parts, badDigest: env.r2.stats.badDigest }));
  check(env.r2.stats.bytes === SIZE, `A: storage got ${env.r2.stats.bytes} of ${SIZE}`);
  check(env.r2.stats.badDigest === 0, 'A: digest mismatch');
  check(!events.includes('fallback'), 'A: unexpected fallback');
  env.r2.server.close(); env.api.server.close();
}

// B: kill at ~40 % then resume from the same job id
{
  const env = await setup();
  const ac = new AbortController();
  let jobId;
  let killedAt = 0;
  try {
    await uploadResumable(blob, env.transport, { concurrency: 4, signal: ac.signal, onEvent: (e) => { if (e.type === 'started') jobId = e.jobId; },
      onProgress: (u, t) => { if (u / t > 0.4 && !ac.signal.aborted) { killedAt = u; ac.abort(); env.r2.stats.sockets.forEach((s) => s.destroy()); } } });
  } catch (e) { check(e.name === 'AbortError' || e.name === 'UploadPausedError', `B: unexpected ${e.name}`); }
  const held = env.r2.stats.parts;
  const bytesBefore = env.r2.stats.bytes;
  check(held > 0 && held < Math.ceil(SIZE / (64 * MiB)), `B: expected a partial upload, held ${held}`);
  await timed('B-resume-after-killed-connection', () => uploadResumable(blob, env.transport, { concurrency: 4, resumeId: jobId }),
    () => ({ killedAtPct: Math.round((killedAt / SIZE) * 100), partsBeforeKill: held, bytesResent: env.r2.stats.bytes - bytesBefore, bytesSkipped: bytesBefore }));
  check(env.r2.stats.bytes - bytesBefore <= SIZE - bytesBefore + 0, 'B: re-sent parts that were already stored');
  check(env.jobs?.get?.(jobId)?.status !== 'uploading', 'B: job should be queued after complete');
  env.r2.server.close(); env.api.server.close();
}

// C: relay through the API (the nginx fallback path)
{
  const env = await setup();
  await timed('C-relay-through-api-streamed', () => uploadResumable(blob, env.transport, { mode: 'api', concurrency: 2 }), () => ({ parts: env.r2.stats.parts, badDigest: env.r2.stats.badDigest }));
  check(env.r2.stats.bytes === SIZE, `C: storage got ${env.r2.stats.bytes}`);
  env.r2.server.close(); env.api.server.close();
}

// D: storage unreachable -> automatic fallback
{
  const env = await setup();
  // Presigned URLs keep pointing at a dead port; the relay talks to the SDK client, so give that a live mock.
  const live = await startMockR2();
  env.svc.store.client.config.endpoint = async () => ({ protocol: 'http:', hostname: '127.0.0.1', port: live.port, path: '/' });
  const transport = env.transport; // the browser's route to storage is dead below; the API's own route (SDK client) is alive
  const sign = transport.sign;
  transport.sign = async (...a) => { const s = await sign(...a); for (const k of Object.keys(s.urls)) s.urls[k] = s.urls[k].replace(`:${live.port}`, ':1'); return s; };
  env.r2.server.close();
  const events = [];
  await timed('D-storage-unreachable-auto-fallback', () => uploadResumable(blob, transport, { concurrency: 2, onEvent: (e) => events.push(e.type) }), () => ({ fellBack: events.includes('fallback') }));
  check(events.includes('fallback'), 'D: no fallback');
  check(live.stats.bytes === SIZE, `D: relay delivered ${live.stats.bytes}`);
  live.server.close(); env.api.server.close();
}

if (!KEEP) fs.rmSync(file, { force: true });
process.exit(failed ? 1 : 0);
