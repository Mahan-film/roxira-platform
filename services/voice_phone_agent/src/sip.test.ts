import assert from 'node:assert/strict';
import test from 'node:test';
import type { Log } from './log.js';
import {
  LOCAL_BRIDGE_CIDR, LOCAL_TRUNK_NAME, ensureSipRouting, keepSipRouting, parseNumbers, safeError, type SipApi,
} from './sip.js';

type Trunk = Awaited<ReturnType<SipApi['listSipInboundTrunk']>>[number];
type Rule = Awaited<ReturnType<SipApi['listSipDispatchRule']>>[number];

// built at runtime so no phone- or IP-shaped literal sits in this public repo
const DIGITS = '7'.repeat(9);
const PRIVATE_IP = [10, 9, 8, 7].join('.');

/** In-memory SipClient: records calls; `failures` makes the next N list calls throw. */
function fakeSip(trunks: Trunk[] = [], rules: Rule[] = [], failures = 0) {
  const calls: string[] = [];
  let n = 0;
  const sip: SipApi = {
    async listSipInboundTrunk() {
      calls.push('listTrunks');
      if (failures > 0) { failures--; throw Object.assign(new Error(`connect refused 127.0.0.1:7880, number ${DIGITS}`), { status: 503 }); }
      return trunks;
    },
    async createSipInboundTrunk(name, numbers, opts) {
      calls.push(`createTrunk:${name}:${numbers.join('|')}:${(opts?.allowedAddresses ?? []).join('|')}`);
      const t = { sipTrunkId: `ST_${++n}`, name, allowedAddresses: opts?.allowedAddresses ?? [] };
      trunks.push(t);
      return t;
    },
    async listSipDispatchRule() { calls.push('listRules'); return rules; },
    async createSipDispatchRule(rule, opts) {
      calls.push(`createRule:${rule.type}:${rule.roomPrefix}:${(opts?.trunkIds ?? []).join('|')}`);
      const r: Rule = {
        sipDispatchRuleId: `SDR_${++n}`, trunkIds: opts?.trunkIds ?? [],
        rule: { rule: { case: 'dispatchRuleIndividual', value: { roomPrefix: rule.roomPrefix } } },
      };
      rules.push(r);
      return r;
    },
  };
  return { sip, calls, trunks, rules };
}

function captureLog() {
  const lines: string[] = [];
  const log: Log = {
    info: (...a) => lines.push(a.join(' ')),
    warn: (...a) => lines.push(`WARN ${a.join(' ')}`),
    error: (...a) => lines.push(`ERROR ${a.join(' ')}`),
  };
  return { log, lines };
}

const individual = (id: string, trunkIds: string[], roomPrefix = 'call-'): Rule => ({
  sipDispatchRuleId: id, trunkIds, rule: { rule: { case: 'dispatchRuleIndividual', value: { roomPrefix } } },
});

test('empty LiveKit: creates one local trunk and one individual rule bound to it', async () => {
  const f = fakeSip();
  const { log } = captureLog();
  const res = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log);
  assert.deepEqual(f.calls, [
    'listTrunks', `createTrunk:${LOCAL_TRUNK_NAME}::${LOCAL_BRIDGE_CIDR}`,
    'listRules', `createRule:individual:call-:${res.trunkId}`,
  ]);
  assert.equal(res.createdTrunk, true);
  assert.equal(res.createdRule, true);
});

test('second run is idempotent: nothing is created again', async () => {
  const f = fakeSip();
  const { log } = captureLog();
  const first = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log);
  f.calls.length = 0;
  const again = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log);
  assert.deepEqual(f.calls, ['listTrunks', 'listRules']);
  assert.deepEqual(again, { trunkId: first.trunkId, ruleId: first.ruleId, createdTrunk: false, createdRule: false });
  assert.equal(f.trunks.length, 1);
  assert.equal(f.rules.length, 1);
});

test('a hand-made trunk with another name that allows 127.0.0.1/32 is reused', async () => {
  const f = fakeSip([
    { sipTrunkId: 'ST_other', name: 'carrier-x', allowedAddresses: ['10.0.0.0/8'] },
    { sipTrunkId: 'ST_hand', name: 'manual', allowedAddresses: [LOCAL_BRIDGE_CIDR] },
  ], [individual('SDR_wild', []), individual('SDR_hand', ['ST_hand'])]);
  const { log } = captureLog();
  const res = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: ['n1'] }, log);
  assert.deepEqual(f.calls, ['listTrunks', 'listRules']);
  assert.equal(res.trunkId, 'ST_hand');
  assert.equal(res.ruleId, 'SDR_hand');
});

test('trunk by name is preferred; a wildcard rule does not count, so a bound rule is created', async () => {
  const f = fakeSip([
    { sipTrunkId: 'ST_cidr', name: 'manual', allowedAddresses: [LOCAL_BRIDGE_CIDR] },
    { sipTrunkId: 'ST_named', name: LOCAL_TRUNK_NAME, allowedAddresses: [LOCAL_BRIDGE_CIDR] },
  ], [individual('SDR_wild', [])]);
  const { log } = captureLog();
  const res = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log);
  assert.equal(res.trunkId, 'ST_named');
  assert.equal(res.createdRule, true);
  assert.deepEqual(f.calls.at(-1), 'createRule:individual:call-:ST_named');
});

test('a different rule already bound to the trunk is reused with a warning, never duplicated', async () => {
  const f = fakeSip([{ sipTrunkId: 'ST_1', name: LOCAL_TRUNK_NAME, allowedAddresses: [LOCAL_BRIDGE_CIDR] }],
    [individual('SDR_other', ['ST_1'], 'room-')]);
  const { log, lines } = captureLog();
  const res = await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log);
  assert.equal(res.ruleId, 'SDR_other');
  assert.equal(f.rules.length, 1);
  assert.ok(lines.some((l) => l.startsWith('WARN') && l.includes('SDR_other')));
});

test('configured numbers go to the new trunk but never into the log', async () => {
  const f = fakeSip();
  const { log, lines } = captureLog();
  await ensureSipRouting(f.sip, { roomPrefix: 'call-', numbers: parseNumbers(' n1, n2 ,,') }, log);
  assert.ok(f.calls.includes(`createTrunk:${LOCAL_TRUNK_NAME}:n1|n2:${LOCAL_BRIDGE_CIDR}`));
  assert.ok(lines.some((l) => l.includes('2 number(s)')));
  assert.ok(!lines.some((l) => /\bn1\b|\bn2\b/.test(l)), lines.join('\n'));
});

test('API errors are retried with a masked warning and never thrown', async () => {
  const f = fakeSip([], [], 2);
  const { log, lines } = captureLog();
  const slept: number[] = [];
  const res = await keepSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log, () => false,
    { firstMs: 10, maxMs: 15 }, async (ms) => { slept.push(ms); });
  assert.ok(res?.createdTrunk);
  assert.deepEqual(slept, [10, 15]);
  const warns = lines.filter((l) => l.startsWith('WARN'));
  assert.equal(warns.length, 2);
  for (const w of warns) {
    assert.ok(w.includes('503'), w);
    assert.ok(!w.includes('127.0.0.1') && !w.includes(DIGITS), w);
  }
});

test('keepSipRouting gives up quietly once the agent is stopping', async () => {
  const f = fakeSip([], [], 99);
  const { log } = captureLog();
  let stop = false;
  const res = await keepSipRouting(f.sip, { roomPrefix: 'call-', numbers: [] }, log, () => stop,
    { firstMs: 1, maxMs: 1 }, async () => { stop = true; });
  assert.equal(res, null);
  assert.equal(f.calls.filter((c) => c === 'listTrunks').length, 1);
});

test('safeError keeps status and code but masks IPs and numbers', () => {
  const e = Object.assign(new Error(`Conflicting inbound SIP Trunks using the same number(s) [+${DIGITS}] from ${PRIVATE_IP}/24`),
    { status: 400, code: 'invalid_argument' });
  const s = safeError(e);
  assert.ok(s.startsWith('400 invalid_argument: '), s);
  assert.ok(!s.includes(DIGITS) && !s.includes(PRIVATE_IP), s);
});
