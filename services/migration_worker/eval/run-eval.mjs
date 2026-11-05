#!/usr/bin/env node
/**
 * Replayable accuracy eval for AI schema discovery (issue #397, phase 2 of #354).
 *
 *   node eval/run-eval.mjs            # offline: replay eval/recorded/<case>.json, print accuracy
 *   node eval/run-eval.mjs --record   # calls the real model through the key pool and writes the
 *                                     # recordings (needs LITELLM_API_KEY and a reachable gateway;
 *                                     # run on the hub/Mac, never in CI)
 *
 * cases.json holds synthetic tables shaped after the four import presets plus three unmappable
 * ones. A recording is the raw model reply for one case. Scoring runs the same guardrails the
 * pipeline uses (parseJsonAnswer + validateAnswer from discover.mjs), so replay measures the AI step
 * offline and CI never calls a model.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../catalog.mjs';
import { buildPrompt, litellmClient, parseJsonAnswer, validateAnswer } from '../discover.mjs';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const CASES_PATH = path.join(DIR, 'cases.json');
export const RECORDED_DIR = path.join(DIR, 'recorded');

/** Sanity guard for acceptance 3: a recording must never carry a phone number or an e-mail. */
export const SECRET_RE = /09[0-9]{9}|@/;

export function loadCases(casesPath = CASES_PATH) {
  const data = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  if (!Array.isArray(data.cases) || data.cases.length === 0) throw new Error(`${casesPath}: no cases`);
  return data.cases;
}

export function loadRecordings(dir = RECORDED_DIR) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    out.set(rec.id ?? file.replace(/\.json$/, ''), rec);
  }
  return out;
}

export function requiredFields(target) {
  return Object.entries(TARGETS[target]?.fields ?? {}).filter(([, d]) => d.required).map(([f]) => f);
}

/**
 * Score one recorded answer for one case. A mappable case is correct only when the target is right
 * AND every required field (plus every field the case expects) is mapped to the right source column.
 * An unmappable case is correct only when it ends as needs-review (never mapped).
 */
export function scoreAnswer(caseDef, answerText) {
  const answer = parseJsonAnswer(answerText);
  const v = validateAnswer(caseDef.table, answer);
  if (caseDef.mappable) {
    if (!v.ok) {
      return { id: caseDef.id, mappable: true, mapped: false, status: 'needs-review', target: null, fields: {}, correct: false, reason: v.reason, hallucinatedColumns: [] };
    }
    const expected = caseDef.expected.fields ?? {};
    const targetOk = v.target === caseDef.expected.target;
    const fieldsOk = requiredFields(v.target).every((f) => v.fields[f] === expected[f])
      && Object.entries(expected).every(([f, c]) => v.fields[f] === c);
    const hallucinatedColumns = Object.values(v.fields).filter((c) => !caseDef.table.columns.includes(c));
    return {
      id: caseDef.id, mappable: true, mapped: true, status: 'mapped', target: v.target, fields: v.fields,
      correct: targetOk && fieldsOk, reason: targetOk ? (fieldsOk ? null : 'field mismatch') : `wrong target ${v.target}`, hallucinatedColumns,
    };
  }
  return {
    id: caseDef.id, mappable: false, mapped: v.ok, status: v.ok ? 'mapped' : 'needs-review', target: v.target ?? null,
    fields: v.fields ?? {}, correct: !v.ok, reason: v.ok ? 'unmappable table was mapped' : v.reason, hallucinatedColumns: [],
  };
}

export function summarise(cases, results) {
  const mappable = results.filter((r) => r.mappable);
  const correct = mappable.filter((r) => r.correct).length;
  const unmappable = results.filter((r) => !r.mappable);
  return {
    cases: cases.length,
    mappable: mappable.length,
    correct,
    accuracy: mappable.length ? correct / mappable.length : 0,
    hallucinatedAccepted: results.filter((r) => r.mapped && r.hallucinatedColumns.length > 0).length,
    unmappable: unmappable.length,
    unmappableNeedsReview: unmappable.filter((r) => !r.mapped).length,
    results,
  };
}

/** Offline replay: every case must have a recording, or the harness tells the operator to record. */
export function replay(cases = loadCases(), recordings = loadRecordings()) {
  const results = cases.map((c) => {
    const rec = recordings.get(c.id);
    if (!rec) throw new Error(`${c.id}: no recording in ${RECORDED_DIR}; run: node eval/run-eval.mjs --record`);
    return scoreAnswer(c, rec.answer);
  });
  return summarise(cases, results);
}

async function record() {
  if (!process.env.LITELLM_API_KEY) throw new Error('LITELLM_API_KEY is required to record (run on the hub/Mac, not in CI)');
  const cases = loadCases();
  fs.mkdirSync(RECORDED_DIR, { recursive: true });
  const events = [];
  const client = litellmClient(process.env, fetch, (e) => events.push(e));
  let calls = 0;
  const groups = new Set();
  for (const c of cases) {
    events.length = 0;
    const answer = await client(buildPrompt(c.table, c.samples ?? []));
    const answers = events.filter((e) => e.phase === 'answer');
    const group = answers.length ? answers[answers.length - 1].model : (process.env.MIGRATION_LLM_MODELS ?? 'unknown');
    calls += events.filter((e) => e.phase === 'request').length;
    groups.add(group);
    const rec = { id: c.id, preset: c.preset, mappable: c.mappable, table: c.table.name, modelGroup: group, calls: events.filter((e) => e.phase === 'request').length, answer };
    if (SECRET_RE.test(JSON.stringify(rec))) throw new Error(`${c.id}: recording would contain a phone or e-mail; refusing to write`);
    fs.writeFileSync(path.join(RECORDED_DIR, `${c.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  }
  const summary = replay(cases, loadRecordings());
  const manifest = { recordedAt: new Date().toISOString().slice(0, 10), modelGroups: [...groups], calls, accuracy: +summary.accuracy.toFixed(4), mappable: summary.mappable, correct: summary.correct, unmappable: summary.unmappable };
  fs.writeFileSync(path.join(RECORDED_DIR, '_summary.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--record')) { await record(); return; }
  const summary = replay();
  const calls = [...loadRecordings().values()].reduce((n, r) => n + (Number(r.calls) || 0), 0);
  console.log(JSON.stringify({ accuracy: +summary.accuracy.toFixed(4), mappable: summary.mappable, correct: summary.correct, hallucinatedAccepted: summary.hallucinatedAccepted, unmappable: summary.unmappable, unmappableNeedsReview: summary.unmappableNeedsReview, calls }, null, 2));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
