import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { TARGETS } from './catalog.mjs';
import { buildPrompt, defaultModelGroups, KEY_POOL_FILE, parseGroupFallbacks } from './discover.mjs';
import { loadCases, loadRecordings, RECORDED_DIR, replay, scoreAnswer, SECRET_RE } from './eval/run-eval.mjs';

const cases = loadCases();
const recordings = loadRecordings();

test('the eval set covers the four presets and three unmappable tables', () => {
  assert.ok(cases.length >= 15, `expected >= 15 cases, got ${cases.length}`);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'ids are unique');
  const mappable = cases.filter((c) => c.mappable);
  const unmappable = cases.filter((c) => !c.mappable);
  assert.ok(mappable.length >= 12, `expected >= 12 mappable cases, got ${mappable.length}`);
  assert.ok(unmappable.length >= 3, `expected >= 3 unmappable cases, got ${unmappable.length}`);
  for (const preset of ['holoo', 'sepidar', 'mahak', 'hamkaran-rahkaran']) {
    assert.ok(mappable.some((c) => c.preset === preset), `no mappable case for preset ${preset}`);
  }
});

test('every expected mapping names a real target, its fields and the source columns', () => {
  for (const c of cases) {
    if (!c.mappable) { assert.equal(c.expected.target, null, `${c.id} unmappable target must be null`); continue; }
    const spec = TARGETS[c.expected.target]?.fields;
    assert.ok(spec, `${c.id}: unknown target ${c.expected.target}`);
    for (const [field, column] of Object.entries(c.expected.fields)) {
      assert.ok(field in spec, `${c.id}: unknown field ${field}`);
      assert.ok(c.table.columns.includes(column), `${c.id}: ${column} is not a source column`);
    }
    for (const [field, def] of Object.entries(spec)) {
      if (def.required) assert.ok(c.expected.fields[field], `${c.id}: required field ${field} not in expected`);
    }
  }
});

test('replay of the recordings reaches >= 0.8 mapping accuracy on mappable tables', () => {
  const summary = replay(cases, recordings);
  assert.ok(summary.accuracy >= 0.8, `accuracy ${summary.accuracy} < 0.8 (${summary.correct}/${summary.mappable})`);
  assert.equal(summary.mappable, cases.filter((c) => c.mappable).length);
});

test('no hallucinated column is accepted; a recorded hallucination is sent to review', () => {
  const summary = replay(cases, recordings);
  assert.equal(summary.hallucinatedAccepted, 0, 'a mapping referenced a column that does not exist');
  for (const r of summary.results) {
    if (r.mapped) for (const column of Object.values(r.fields)) {
      const c = cases.find((x) => x.id === r.id);
      assert.ok(c.table.columns.includes(column), `${r.id}: accepted column ${column} is not real`);
    }
  }
  const bad = scoreAnswer(cases.find((c) => c.id === 'sepidar-vouchers'), recordings.get('sepidar-vouchers').answer);
  assert.equal(bad.mapped, false, 'the hallucinated date column must not be accepted');
  assert.equal(bad.status, 'needs-review');
  assert.match(bad.reason, /does not exist/);
});

test('unmappable tables end as needs-review', () => {
  const summary = replay(cases, recordings);
  for (const c of cases.filter((c) => !c.mappable)) {
    const r = summary.results.find((x) => x.id === c.id);
    assert.equal(r.status, 'needs-review', `${c.id} must end as needs-review`);
    assert.equal(r.mapped, false);
  }
  assert.equal(summary.unmappableNeedsReview, summary.unmappable);
});

test('recordings never carry a phone number or an e-mail (maskSample check)', () => {
  for (const file of fs.readdirSync(RECORDED_DIR)) {
    if (!file.endsWith('.json')) continue;
    const text = fs.readFileSync(path.join(RECORDED_DIR, file), 'utf8');
    assert.ok(!SECRET_RE.test(text), `${file} contains an unmasked phone or e-mail`);
  }
});

test('samples are masked before they could leave the box', () => {
  const c = cases.find((x) => x.id === 'holoo-parties');
  const phone = `09${'0'.repeat(9)}`;
  const prompt = JSON.stringify(buildPrompt(c.table, [{ ...c.samples[0], 'تلفن': phone }]));
  assert.ok(prompt.includes('09#########'), 'the phone sample should be masked');
  assert.ok(!prompt.includes(phone), 'the raw phone sample must not appear in the prompt');
});

test('default discovery groups come from config/key_pool.yaml, not from code', () => {
  assert.deepEqual(defaultModelGroups({}), ['agent-light-free', 'agent-free-paid']);
  assert.deepEqual(defaultModelGroups({ MIGRATION_LLM_MODELS: 'a, b' }), ['a', 'b'], 'env override wins');
  const groups = parseGroupFallbacks(fs.readFileSync(KEY_POOL_FILE, 'utf8'));
  assert.ok(groups.has('agent-light-free'));
  assert.ok(groups.get('agent-light-free').fallback.includes('agent-free-paid'));
});
