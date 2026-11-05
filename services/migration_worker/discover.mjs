/**
 * Schema discovery: which source table is which Roxira target, and which source column feeds which field.
 * Two stages. (1) A deterministic heuristic over normalised names. (2) For tables it cannot place, an LLM sees the
 * table name, the column names and 5 masked sample values per column and answers in JSON. The answer is never
 * trusted: it is validated against the real columns and the target's required fields, and anything else is
 * reported as `needs-review` (the customer decides in the review step).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './catalog.mjs';
import { normalizeText } from './normalize.mjs';

/** Name key: Persian-normalised, lower-case, letters and digits only. */
export const nameKey = (s) => (normalizeText(s) ?? '').toLowerCase().replace(/[\s_\-./\\()[\]]+/g, '').replace(/[^\p{L}\p{N}]/gu, '');

function fieldScore(columnKey, synonyms) {
  let best = 0;
  for (const syn of synonyms) {
    const k = nameKey(syn);
    if (!k) continue;
    if (columnKey === k) return 1;
    if (k.length >= 3 && (columnKey.includes(k) || (columnKey.length >= 3 && k.includes(columnKey)))) best = Math.max(best, 0.6);
  }
  return best;
}

/** Greedy best assignment of source columns to one target's fields. */
export function mapFields(columns, target) {
  const spec = TARGETS[target].fields;
  const pairs = [];
  for (const [field, def] of Object.entries(spec)) {
    for (const column of columns) {
      const score = fieldScore(nameKey(column), def.synonyms);
      if (score > 0) pairs.push({ field, column, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const fields = {};
  const used = new Set();
  for (const p of pairs) {
    if (fields[p.field] || used.has(p.column)) continue;
    fields[p.field] = p.column;
    used.add(p.column);
  }
  const required = Object.entries(spec).filter(([, d]) => d.required).map(([f]) => f);
  const coverage = required.filter((f) => fields[f]).length / required.length;
  const mean = Object.keys(fields).length === 0 ? 0 : pairs.filter((p) => fields[p.field] === p.column).reduce((s, p) => s + p.score, 0) / Object.keys(fields).length;
  return { fields, coverage, confidence: +(coverage * mean).toFixed(2) };
}

/** Heuristic placement of one table. `ambiguous` when two targets tie closely, so the AI/customer decides. */
export function heuristicMap(table) {
  const tableKey = nameKey(table.name);
  const ranked = Object.keys(TARGETS)
    .map((target) => {
      const m = mapFields(table.columns, target);
      const hint = TARGETS[target].hints.some((h) => nameKey(h).length >= 2 && tableKey.includes(nameKey(h))) ? 0.25 : 0;
      return { target, ...m, rank: m.confidence + (m.coverage === 1 ? hint : 0) };
    })
    .filter((r) => r.coverage === 1)
    .sort((a, b) => b.rank - a.rank);
  if (ranked.length === 0) return { status: 'unmapped' };
  const [best, second] = ranked;
  if (second && best.rank - second.rank < 0.15) return { status: 'ambiguous', candidates: ranked.slice(0, 3).map((r) => r.target) };
  if (best.rank < 0.6) return { status: 'low-confidence', target: best.target, fields: best.fields, confidence: best.confidence };
  return { status: 'mapped', target: best.target, fields: best.fields, confidence: Math.min(1, best.rank), source: 'heuristic' };
}

const MASKS = [[/\b09\d{9}\b/g, '09#########'], [/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'x@x.x']];
/** Samples leave the box only masked and truncated: mobile numbers and e-mails are replaced, cells cut to 40 chars. */
export function maskSample(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).slice(0, 40);
  for (const [re, rep] of MASKS) s = s.replace(re, rep);
  return s;
}

export function buildPrompt(table, samples) {
  const catalog = Object.fromEntries(Object.entries(TARGETS).map(([t, d]) => [t, Object.fromEntries(Object.entries(d.fields).map(([f, x]) => [f, `${x.type}${x.required ? ' (required)' : ''}${x.values ? ` ${x.values.join('|')}` : ''}`]))]));
  const cols = table.columns.map((c) => ({ column: c, samples: samples.map((r) => maskSample(r[c])) }));
  return [
    { role: 'system', content: 'You map columns of an unknown Iranian accounting database to a fixed target model. Answer with one JSON object only, no prose. Use only column names that appear in the input. If the table is not any target, answer {"target":null}.' },
    { role: 'user', content: JSON.stringify({ targets: catalog, table: { name: table.name, rows: table.rows, columns: cols }, answer: { target: 'one target key or null', fields: { '<target field>': '<source column>' }, confidence: '0..1' } }) },
  ];
}

/** Validation of the model's answer: real columns only, required fields present, no column used twice. */
export function validateAnswer(table, answer) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'not an object' };
  if (answer.target === null) return { ok: false, reason: 'model says: no target' };
  const spec = TARGETS[answer.target]?.fields;
  if (!spec) return { ok: false, reason: `unknown target ${String(answer.target)}` };
  const fields = {};
  const used = new Set();
  for (const [f, c] of Object.entries(answer.fields ?? {})) {
    if (!(f in spec)) return { ok: false, reason: `unknown field ${f}` };
    if (typeof c !== 'string' || !table.columns.includes(c)) return { ok: false, reason: `column ${String(c)} does not exist` };
    if (used.has(c)) return { ok: false, reason: `column ${c} used twice` };
    used.add(c);
    fields[f] = c;
  }
  const missing = Object.entries(spec).filter(([f, d]) => d.required && !fields[f]).map(([f]) => f);
  if (missing.length) return { ok: false, reason: `required fields missing: ${missing.join(', ')}` };
  const confidence = Math.max(0, Math.min(1, Number(answer.confidence) || 0.5));
  return { ok: true, target: answer.target, fields, confidence };
}

export function parseJsonAnswer(text) {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * @param tables  [{ name, rows, columns }]
 * @param getSamples  async (table) => up to 5 row objects
 * @param ask  async (messages) => string (the model's reply); omit for heuristic-only
 */
export async function discoverSchema(tables, getSamples, ask) {
  const result = [];
  for (const table of tables) {
    const h = heuristicMap(table);
    if (h.status === 'mapped') { result.push({ table: table.name, ...h }); continue; }
    if (!ask) { result.push({ table: table.name, status: 'needs-review', reason: h.status, candidates: h.candidates }); continue; }
    try {
      const samples = await getSamples(table);
      const v = validateAnswer(table, parseJsonAnswer(await ask(buildPrompt(table, samples))));
      result.push(v.ok ? { table: table.name, status: 'mapped', target: v.target, fields: v.fields, confidence: Math.min(v.confidence, 0.9), source: 'ai' } : { table: table.name, status: 'needs-review', reason: `ai: ${v.reason}` });
    } catch (e) {
      result.push({ table: table.name, status: 'needs-review', reason: `ai failed: ${e.message}` });
    }
  }
  return result;
}

/** config/key_pool.yaml is the source of truth for the LiteLLM groups. Overridable for tests. */
export const KEY_POOL_FILE = process.env.MIGRATION_KEY_POOL_FILE
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'key_pool.yaml');

/**
 * Minimal reader for the top-level `groups:` mapping of config/key_pool.yaml: group name -> its
 * `fallback:` list. A full YAML parser is not pulled in (this is the only key_pool field the
 * worker needs, and the file is checked into the repo). Comment-only and nested lines are ignored.
 */
export function parseGroupFallbacks(yamlText) {
  const groups = new Map();
  let inGroups = false;
  let current = null;
  for (const raw of String(yamlText).split(/\r?\n/)) {
    if (/^groups:\s*(#.*)?$/.test(raw)) { inGroups = true; continue; }
    if (!inGroups) continue;
    if (/^\S/.test(raw)) break; // the next top-level key: groups is done
    const line = raw.replace(/#.*$/, '');
    const key = /^  ([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (key) { current = key[1]; groups.set(current, { fallback: [] }); continue; }
    const fb = /^    fallback:\s*\[([^\]]*)\]/.exec(line);
    if (fb && current) groups.get(current).fallback = fb[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return groups;
}

/**
 * Default LiteLLM groups for schema discovery: the light free group, then the cheap paid fallback
 * from the same `fallback:` chain in config/key_pool.yaml (agent-light-free, then agent-free-paid).
 * MIGRATION_LLM_MODELS overrides it. No model id is ever hardcoded here (AGENTS.md section 3).
 */
export function defaultModelGroups(env = process.env) {
  if (env.MIGRATION_LLM_MODELS) return env.MIGRATION_LLM_MODELS.split(',').map((m) => m.trim()).filter(Boolean);
  const groups = parseGroupFallbacks(fs.readFileSync(KEY_POOL_FILE, 'utf8'));
  const names = [...groups.keys()];
  const primary = names.find((n) => /^agent-.*light.*free$/.test(n));
  if (!primary) throw new Error(`config/key_pool.yaml: no agent light-free group found in ${KEY_POOL_FILE}`);
  const paid = groups.get(primary).fallback.find((g) => /paid/.test(g))
    ?? names.find((n) => /^agent-.*paid$/.test(n));
  if (!paid) throw new Error(`config/key_pool.yaml: no paid fallback for ${primary} in ${KEY_POOL_FILE}`);
  return [primary, paid];
}

/**
 * Default model client: LiteLLM (OpenAI-compatible) key-pool groups, free first then free-paid (from
 * config/key_pool.yaml). The key is read from the environment and never logged. `onCall` is an optional
 * observer used by the eval to record which group answered; it never sees the key.
 */
export function litellmClient(env = process.env, fetchImpl = fetch, onCall = () => {}) {
  const base = env.MIGRATION_LLM_URL ?? 'http://127.0.0.1:4000/v1/chat/completions';
  const models = defaultModelGroups(env);
  return async (messages) => {
    let lastError = new Error('no model configured');
    for (const model of models) {
      try {
        onCall({ phase: 'request', model });
        const res = await fetchImpl(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(env.LITELLM_API_KEY ? { authorization: `Bearer ${env.LITELLM_API_KEY}` } : {}) }, body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 800 }), signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const content = (await res.json()).choices?.[0]?.message?.content ?? '';
        onCall({ phase: 'answer', model, content });
        return content;
      } catch (e) { onCall({ phase: 'error', model, error: e.message }); lastError = e; }
    }
    throw lastError;
  };
}
