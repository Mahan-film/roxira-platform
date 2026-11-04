#!/usr/bin/env node
/**
 * Read-write probe of the REAL import bucket (owner/ops run it once, on srv1 or a laptop, before setting
 * IMPORT_PART_CHECKSUMS=1). Proves four things with a 5 MiB scratch upload under `_probe/`, then removes it:
 *   1. a presigned part PUT works,  2. R2 enforces the signed x-amz-checksum-sha256 (wrong digest -> 4xx),
 *   3. the SDK relay path (what the API does for the nginx fallback) works,  4. ListParts reports the sizes.
 * Also prints the CORS line to verify by hand. Values come only from the environment and are never printed.
 *
 *   set -a; . ~/Secrets/roxira/roxira.env; set +a      # R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
 *   NODE_PATH=output_apps/enterprise_hub/node_modules node scripts/ops/huge_import_probe.mjs
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

for (const k of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[k]) { console.error(`missing ${k}`); process.exit(2); }
}
const Bucket = process.env.R2_BUCKET;
const client = new S3Client({
  region: 'auto', endpoint: process.env.R2_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
});
const Key = `_probe/${randomBytes(6).toString('hex')}`;
const body = randomBytes(5 * 1024 * 1024);
const sum = createHash('sha256').update(body).digest('base64');
const bad = createHash('sha256').update('x').digest('base64');
let ok = true;
const report = (name, pass, extra = '') => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket, Key }));
try {
  const presign = (n, c) => getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: n, ...(c ? { ChecksumSHA256: c } : {}) }), { expiresIn: 600, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) });
  const put = (url, headers) => fetch(url, { method: 'PUT', body, headers }).then((r) => r.status).catch((e) => `net:${e.cause?.code ?? e.message}`);
  report('presigned PUT with correct SHA-256', (await put(await presign(1, sum), { 'x-amz-checksum-sha256': sum })) === 200);
  const wrong = await put(await presign(2, sum), { 'x-amz-checksum-sha256': bad });
  report('R2 rejects a part whose digest does not match (enforcement)', typeof wrong === 'number' && wrong >= 400 && wrong < 500, `status ${wrong}`);
  await client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 3, Body: body, ContentLength: body.length, ChecksumSHA256: sum }));
  report('relay path (SDK stream with ContentLength + digest)', true);
  const parts = (await client.send(new ListPartsCommand({ Bucket, Key, UploadId }))).Parts ?? [];
  report('ListParts shows the good parts only', parts.map((p) => p.PartNumber).join() === '1,3' && parts.every((p) => p.Size === body.length), `parts ${parts.map((p) => p.PartNumber)}`);
} catch (e) {
  report('probe', false, String(e.name ?? e.message));
} finally {
  await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => {});
}
console.log('\nBy hand: bucket CORS must allow PUT from https://roxira.ir with AllowedHeaders * and ExposeHeaders ETag (docs/BULK_IMPORT.md).');
console.log(ok ? '\nAll checks passed: set IMPORT_PART_CHECKSUMS=1 on the backend.' : '\nSome checks failed: leave IMPORT_PART_CHECKSUMS unset.');
process.exit(ok ? 0 : 1);
