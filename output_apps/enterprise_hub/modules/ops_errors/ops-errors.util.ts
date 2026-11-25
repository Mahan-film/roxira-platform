import { createHash } from 'crypto';
import { MAX_ROUTE, MAX_SAMPLE_MESSAGE, MAX_SAMPLE_STACK } from './constants/ops-errors.constants';

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const KV_SECRET = /\b(token|key|secret|password|pass|otp|code|authorization|apikey|api_key)=\S+/gi;
const URL_QUERY = /\?[^\s"'<>)]*/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const LONG_DIGITS = /\d{7,}/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Removes secrets and PII from a message or stack: JWTs, bearer headers, key=value secrets, query
 * strings, e-mails, long tokens, and any digit run longer than 6 (phone, national id, card).
 */
export function scrubText(text: string): string {
  return text
    .replace(JWT, '[jwt]')
    .replace(BEARER, '[bearer]')
    .replace(KV_SECRET, '$1=[x]')
    .replace(URL_QUERY, '')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[uuid]')
    .replace(LONG_TOKEN, '[token]')
    .replace(LONG_DIGITS, '[num]');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Collapses volatile parts (numbers, ids) so equal errors share a fingerprint. */
export function normalizeMessage(message: string): string {
  return scrubText(message)
    .replace(/\[(?:uuid|token|num|email|jwt|bearer)\]/g, '#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * First stack frame that belongs to the app (not node_modules, not node internals), reduced to
 * `function@file` without line numbers so a rebuild does not change the fingerprint.
 */
export function topAppFrame(stack: string | undefined): string {
  if (!stack) return 'no-stack';
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('node_modules') || line.includes('node:internal') || line.includes('(node:')) continue;
    const m = /^at\s+(?:(.+?)\s+\()?(.*?)(?::\d+)?(?::\d+)?\)?$/.exec(line);
    const fn = m?.[1] ?? 'anonymous';
    const file = (m?.[2] ?? line).split(/[\\/]/).pop()?.replace(/:\d+/g, '') ?? 'unknown';
    return `${fn}@${file}`;
  }
  return 'no-app-frame';
}

export function computeFingerprint(errorClass: string, message: string, stack: string | undefined): string {
  return createHash('sha256')
    .update(`${errorClass}\n${normalizeMessage(message)}\n${topAppFrame(stack)}`)
    .digest('hex');
}

/** Eight characters are enough to quote a fingerprint in a chat message. */
export const shortId = (fingerprint: string): string => fingerprint.slice(0, 8);

/** Route pattern without query string; numeric ids in a raw URL are masked. */
export function safeRoute(pattern: string | undefined, url: string | undefined): string | null {
  const raw = pattern ?? url?.split(/[?#]/, 1)[0];
  if (!raw) return null;
  return truncate(scrubText(raw).replace(/\/\d+(?=\/|$)/g, '/:n'), MAX_ROUTE);
}

export interface OpsErrorEvent {
  fingerprint: string;
  source: string;
  errorClass: string;
  route: string | null;
  httpMethod: string | null;
  status: number | null;
  release: string | null;
  tenantId: string | null;
  sampleMessage: string;
  sampleStack: string;
}

export interface OpsErrorContext {
  source?: string;
  route?: string | null;
  httpMethod?: string | null;
  status?: number | null;
  tenantId?: string | null;
  release?: string | null;
}

const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

export function currentRelease(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.GIT_SHA ?? env.RELEASE;
  return v && v !== 'unknown' ? v.slice(0, 12) : null;
}

/** Builds the storable event from any thrown value. Never includes bodies, headers or query strings. */
export function buildEvent(error: unknown, ctx: OpsErrorContext = {}): OpsErrorEvent {
  const err = error instanceof Error ? error : undefined;
  const errorClass = truncate(err?.constructor?.name || err?.name || typeof error, 120);
  const message = err?.message ?? (typeof error === 'string' ? error : 'non-error thrown');
  const stack = err?.stack;
  return {
    fingerprint: computeFingerprint(errorClass, message, stack),
    source: ctx.source ?? 'backend',
    errorClass,
    route: ctx.route ?? null,
    httpMethod: ctx.httpMethod ? ctx.httpMethod.toUpperCase().slice(0, 10) : null,
    status: ctx.status ?? null,
    release: ctx.release ?? currentRelease(),
    tenantId: ctx.tenantId && UUID_RE.test(ctx.tenantId) ? ctx.tenantId : null,
    sampleMessage: truncate(scrubText(message), MAX_SAMPLE_MESSAGE),
    sampleStack: truncate(scrubText(stack ?? ''), MAX_SAMPLE_STACK),
  };
}
