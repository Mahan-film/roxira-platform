/**
 * Resumable, parallel multipart upload straight to object storage (R2 / S3), with a per-part SHA-256 and an
 * automatic fallback that relays parts through the API when the browser cannot reach storage.
 *
 * Framework-free on purpose: no React, no `@/` imports, only `fetch`, `Blob` and `crypto.subtle`. The server
 * calls are injected (`UploadTransport`), so it runs in a browser, in Node (tests, benchmark) and in workers.
 * The caller owns the job id; keep it (e.g. in localStorage) and pass it back as `resumeId` to continue after a
 * closed tab, a dead connection or a reboot: only the parts storage does not already hold are sent.
 *
 * Memory: one part (default 64 MiB) per in-flight request. With `concurrency` 4 that is at most ~256 MiB of
 * `Blob` slices (browsers keep these on disk-backed storage) plus one part being hashed.
 */

export interface UploadStart {
  jobId: string;
  partBytes: number;
  totalParts: number;
  /** Browser may PUT to presigned URLs. */
  direct: boolean;
  /** API may relay a part to storage (fallback). */
  proxyParts: boolean;
  /** Server will bind a per-part SHA-256 into the signed URL. */
  checksums: boolean;
}

export interface UploadedPart {
  partNumber: number;
  size: number;
}

export interface SignedParts {
  urls: Record<string, string>;
  /** Extra headers the browser must send with each PUT (e.g. `x-amz-checksum-sha256`). */
  headers?: Record<string, Record<string, string>>;
}

/** What the server must offer. `bulk-import-client.ts` implements it over the Roxira API. */
export interface UploadTransport {
  start(file: { name: string; size: number }, signal?: AbortSignal): Promise<UploadStart>;
  /** Server capabilities, needed when resuming (start() is not called again). */
  capabilities(signal?: AbortSignal): Promise<Pick<UploadStart, "direct" | "proxyParts" | "checksums">>;
  listParts(jobId: string, signal?: AbortSignal): Promise<{ partBytes: number; totalParts: number; uploaded: UploadedPart[] }>;
  sign(jobId: string, partNumbers: number[], checksums: Record<string, string>, signal?: AbortSignal): Promise<SignedParts>;
  /** Relay one part through the API (fallback). Resolves when the server answered 2xx. */
  putViaApi(jobId: string, partNumber: number, body: Blob, headers: Record<string, string>, signal?: AbortSignal): Promise<void>;
  complete(jobId: string, signal?: AbortSignal): Promise<void>;
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** Existing upload to continue. Unknown or closed ids make `listParts` throw; the caller then starts fresh. */
  resumeId?: string;
  concurrency?: number;
  /** Parts retried this many times on network errors / 5xx before the upload pauses with an error. */
  maxRetries?: number;
  /** Consecutive direct-PUT network failures (no HTTP answer at all) before switching to the API relay. */
  fallbackAfter?: number;
  /** Force a path: `auto` (default) tries storage, then the relay. */
  mode?: "auto" | "direct" | "api";
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  onEvent?: (event: UploadEvent) => void;
  /** Overridable for tests. */
  putPart?: PutPart;
  sleep?: (ms: number) => Promise<void>;
}

export type UploadEvent =
  | { type: "started"; jobId: string; totalParts: number; alreadyUploaded: number }
  | { type: "part-done"; partNumber: number; via: "direct" | "api" }
  | { type: "part-retry"; partNumber: number; attempt: number; reason: string }
  | { type: "fallback"; reason: string };

export type PutPart = (
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal,
) => Promise<void>;

/** HTTP answered with a status: a real answer, not a connectivity failure. */
export class UploadHttpError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `upload failed with HTTP ${status}`);
    this.name = "UploadHttpError";
    this.status = status;
  }
}

/** The upload stopped but can be continued with `resumeId`. */
export class UploadPausedError extends Error {
  readonly jobId: string;
  constructor(jobId: string, cause: string) {
    super(`upload paused (${cause}); continue with resumeId ${jobId}`);
    this.name = "UploadPausedError";
    this.jobId = jobId;
  }
}

export async function sha256Base64(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Default part PUT: `fetch` (works in browsers and Node). Browsers needing byte progress pass an XHR version. */
export const fetchPutPart: PutPart = async (url, body, headers, onBytes, signal) => {
  const response = await fetch(url, { method: "PUT", body, headers, signal });
  if (!response.ok) throw new UploadHttpError(response.status);
  onBytes(body.size);
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadResumable(file: File | Blob & { name?: string }, transport: UploadTransport, options: UploadOptions = {}): Promise<string> {
  const { signal } = options;
  const put = options.putPart ?? fetchPutPart;
  const sleep = options.sleep ?? delay;
  const maxRetries = options.maxRetries ?? 6;
  const fallbackAfter = options.fallbackAfter ?? 3;
  const name = (file as File).name ?? "upload";

  let started: UploadStart;
  if (options.resumeId) {
    const [parts, caps] = await Promise.all([transport.listParts(options.resumeId, signal), transport.capabilities(signal)]);
    started = { jobId: options.resumeId, partBytes: parts.partBytes, totalParts: parts.totalParts, ...caps };
  } else {
    started = await transport.start({ name, size: file.size }, signal);
  }
  const { jobId, partBytes, totalParts } = started;
  const have = new Map((await transport.listParts(jobId, signal)).uploaded.map((p) => [p.partNumber, p.size]));
  const sizeOf = (n: number) => (n < totalParts ? partBytes : file.size - partBytes * (totalParts - 1));

  let useApi = options.mode === "api" || (!started.direct && started.proxyParts);
  if (options.mode === "direct" && !started.direct) throw new Error("this server has no direct upload");
  if (useApi && !started.proxyParts) throw new Error("this server cannot relay parts");
  let networkFailures = 0;

  let doneBytes = 0;
  for (const [n] of have) doneBytes += sizeOf(n);
  const live = new Map<number, number>();
  const report = () => {
    let sum = doneBytes;
    live.forEach((v) => (sum += v));
    options.onProgress?.(Math.min(file.size, sum), file.size);
  };
  options.onEvent?.({ type: "started", jobId, totalParts, alreadyUploaded: have.size });
  report();

  const todo: number[] = [];
  for (let n = 1; n <= totalParts; n += 1) if (!have.has(n) || have.get(n) !== sizeOf(n)) todo.push(n);

  const sendOne = async (n: number): Promise<void> => {
    const blob = file.slice((n - 1) * partBytes, (n - 1) * partBytes + sizeOf(n));
    const checksum = started.checksums ? await sha256Base64(blob) : undefined;
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      live.set(n, 0);
      const onBytes = (loaded: number) => {
        live.set(n, loaded);
        report();
      };
      try {
        if (useApi) {
          await transport.putViaApi(jobId, n, blob, checksum ? { "x-amz-checksum-sha256": checksum } : {}, signal);
        } else {
          const signed = await transport.sign(jobId, [n], checksum ? { [n]: checksum } : {}, signal);
          const url = signed.urls[String(n)];
          if (!url) throw new UploadHttpError(500, "server returned no URL for the part");
          await put(url, blob, signed.headers?.[String(n)] ?? {}, onBytes, signal);
          networkFailures = 0;
        }
        live.delete(n);
        doneBytes += sizeOf(n);
        report();
        options.onEvent?.({ type: "part-done", partNumber: n, via: useApi ? "api" : "direct" });
        return;
      } catch (error) {
        live.delete(n);
        if (isAbort(error) || signal?.aborted) throw error;
        const status = error instanceof UploadHttpError ? error.status : (error as { statusCode?: number }).statusCode;
        // 4xx from our API/storage (bad signature, quota, wrong size) will not heal by retrying; 408/429 will.
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) throw error;
        if (status === undefined && !useApi && options.mode !== "direct") {
          networkFailures += 1;
          if (networkFailures >= fallbackAfter && started.proxyParts) {
            useApi = true;
            options.onEvent?.({ type: "fallback", reason: "storage unreachable from this network" });
            continue;
          }
        }
        if (attempt >= maxRetries) throw new UploadPausedError(jobId, error instanceof Error ? error.message : "network");
        options.onEvent?.({ type: "part-retry", partNumber: n, attempt: attempt + 1, reason: error instanceof Error ? error.message : "error" });
        await sleep(Math.min(15_000, 500 * 2 ** attempt));
      }
    }
  };

  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, todo.length || 1)) }, async () => {
    while (next < todo.length && !failed) {
      const n = todo[next];
      next += 1;
      try {
        await sendOne(n);
      } catch (error) {
        failed = true; // stop the other workers from starting new parts
        throw error;
      }
    }
  });
  await Promise.all(workers);
  await transport.complete(jobId, signal);
  return jobId;
}
