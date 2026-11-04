import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { SUSPENSE, buildCertificate, canGoLive, parseScaled4, roundRial } from './certificate.mjs';
import { stageAll } from './stage.mjs';
import { transformManifest } from './transform.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
function bundle(tables) {
  const dir = tmp();
  const m = { version: 1, source: { kind: 'extractor', sqlMajor: 9, databaseName: 'Holoo1', collation: null, createdAt: 'x' }, tables: [] };
  tables.forEach((t, i) => {
    const gz = gzipSync(t.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, `t${i + 1}.ndjson.gz`), gz);
    m.tables.push({ schema: 'dbo', name: t.name, rows: t.rows.length, file: `t${i + 1}.ndjson.gz`, sha256: createHash('sha256').update(gz).digest('hex'), columns: Object.keys(t.rows[0]).map((name) => ({ name, type: 'nvarchar' })) });
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return dir;
}
const map = (table, target, fields) => ({ table, status: 'mapped', target, fields });

async function run(extra = {}) {
  const tables = [
    { name: 'Chart', rows: [{ code: '1011', name: 'صندوق' }, { code: '1103', name: 'دریافتنی' }, { code: '2010', name: 'پرداختنی' }, { code: '3010', name: 'سرمایه' }] },
    { name: 'TB', rows: [{ acc: '1011', dr: '10,000,000', cr: '0' }, { acc: '2010', dr: '0', cr: '6,000,000' }, { acc: '3010', dr: '0', cr: '4,000,000' }] },
    { name: 'Lines', rows: [
      { acc: '1011', v: 'V1', d: '10,000,000', c: '0' }, { acc: '3010', v: 'V1', d: '0', c: '4,000,000' }, { acc: '2010', v: 'V1', d: '0', c: '6,000,000' },
      { acc: '1011', v: 'V2', d: '1,000', c: '0' }, // unbalanced voucher: the bad source document
      { acc: '9999', v: 'V3', d: '5', c: '5' }, // account missing from the chart
    ] },
    { name: 'Moves', rows: [
      { it: 'A', wh: 'W', dt: '1403/01/01', q: '10', cost: '100', dir: 'in' }, { it: 'A', wh: 'W', dt: '1403/02/01', q: '10', cost: '120', dir: 'in' }, { it: 'A', wh: 'W', dt: '1403/03/01', q: '15', cost: '0', dir: 'out' },
      { it: 'B', wh: 'W', dt: '1403/01/01', q: '3', cost: '50', dir: 'out' }, { it: 'B', wh: 'W', dt: '1403/02/01', q: '2', cost: '50', dir: 'in' },
      { it: 'C', wh: 'W', dt: '1403/01/01', q: '4', cost: '10', dir: 'in' },
    ] },
    { name: 'Bal', rows: [{ it: 'A', wh: 'W', q: '5', v: '600' }, { it: 'C', wh: 'W', q: '5', v: '40' }] },
    { name: 'Open', rows: [{ p: 'P1', n: 'F1', amt: '700', k: 'ar' }, { p: 'P2', n: 'F2', amt: '300', k: 'ar' }, { p: 'P3', n: 'F3', amt: '900', k: 'ap' }] },
    { name: 'Chq', rows: [{ n: '1', due: '1403/06/01', amt: '500', dir: 'receivable', st: 'در جریان وصول' }, { n: '2', due: '1403/06/02', amt: '999', dir: 'receivable', st: 'وصول شده' }] },
  ];
  const dir = bundle(tables);
  const out = tmp();
  const { tables: t, conn } = await transformManifest({ dir, outDir: out, memoryLimit: '512MB' });
  const mappings = [
    map('Chart', 'gl_accounts', { code: 'code', name: 'name' }),
    map('TB', 'gl_trial_balance', { account_code: 'acc', debit: 'dr', credit: 'cr' }),
    map('Lines', 'gl_lines', { account_code: 'acc', voucher_no: 'v', debit: 'd', credit: 'c' }),
    map('Moves', 'stock_moves', { item_code: 'it', warehouse: 'wh', date: 'dt', qty: 'q', unit_cost: 'cost', direction: 'dir' }),
    map('Bal', 'stock_balances', { item_code: 'it', warehouse: 'wh', qty: 'q', value: 'v' }),
    map('Open', 'open_items', { party_code: 'p', doc_no: 'n', amount: 'amt', kind: 'k' }),
    map('Chq', 'cheques', { cheque_no: 'n', due_date: 'due', amount: 'amt', direction: 'dir', status: 'st' }),
  ];
  await stageAll({ conn, tables: t, mappings, outDir: out });
  return buildCertificate({ conn, outDir: out, tenantId: '11111111-1111-4111-8111-111111111111', sourceName: 'Holoo1', generatedAt: '2026-11-05T00:00:00Z', control: { ar: ['1103'], chequesReceivable: ['1011'], ...extra } });
}

test('rial arithmetic: scaled parse and half-away-from-zero rounding', () => {
  assert.equal(parseScaled4('12345.6789'), 123456789n);
  assert.equal(parseScaled4('-0.5'), -5000n);
  assert.equal(roundRial(parseScaled4('0.5')), 1n);
  assert.equal(roundRial(parseScaled4('-0.5')), -1n);
  assert.equal(roundRial(parseScaled4('2.4999')), 2n);
});

test('trial balance: the difference per account goes to suspense and the unbalanced voucher is named', async () => {
  const c = await run();
  const tb = c.trialBalance;
  assert.equal(tb.sourceTrialBalanceProvided, true);
  assert.equal(tb.accountsWithDifference, 1);
  assert.equal(tb.differences[0].account, '1011');
  assert.equal(tb.differences[0].difference, '-1000'); // source 10,000,000 vs migrated 10,001,000
  assert.deepEqual(tb.differences[0].suspectDocuments[0], { sourceTable: 'Lines', voucher: 'V2', firstRow: 4, voucherDifference: '1000' });
  assert.equal(tb.suspense.code, SUSPENSE.code);
  assert.equal(tb.suspense.amount, '1000'); // posting the correction to the suspense account
  assert.equal(tb.unbalancedVoucherCount, 1);
  assert.deepEqual(tb.unknownAccounts, [{ account: '9999', net: '0' }]);
  assert.equal(tb.migratedTotals.balanced, false);
});

test('stock: quantity and FIFO value per item and warehouse, negative stock with a proposed adjustment', async () => {
  const s = (await run()).stock;
  assert.equal(s.valuation, 'FIFO');
  assert.equal(s.itemWarehousePairs, 3);
  // A: in 10@100, in 10@120, out 15 -> 5 left, all from the 120 layer = 600, equals the source balance (no difference listed).
  assert.ok(!s.differences.some((d) => d.item === 'A'));
  // C: moves say 4, the source balance says 5 with value 40
  const c = s.differences.find((d) => d.item === 'C');
  assert.equal(c.qtyDifference, '-1');
  assert.equal(c.valueComputed, '40');
  // B went negative (out 3 before in 2): ends at -1
  const b = s.negativeStock.find((n) => n.item === 'B');
  assert.equal(b.endingQty, '-1');
  assert.equal(b.proposedAdjustmentQty, '3');
});

test('AR/AP and cheques in transit against the designated control accounts', async () => {
  const c = await run();
  const sub = c.subledgers;
  assert.equal(sub.openItems.ar.total, '1000');
  assert.equal(sub.openItems.ap.total, '900');
  assert.equal(sub.openItems.controlAr.ledgerBalance, '0'); // nothing posted to 1103 in the lines
  assert.equal(sub.openItems.controlAr.difference, '-1000');
  assert.equal(sub.cheques.receivable.total, '500', 'the cleared cheque is not in transit');
  assert.equal(sub.cheques.receivable.count, 1);
});

test('status blocks, names every reason, and nothing goes live without approval of this exact certificate', async () => {
  const c = await run();
  assert.equal(c.status, 'blocked');
  assert.ok(c.blocking.some((b) => b.code === 'lines-unbalanced'));
  assert.ok(c.blocking.some((b) => b.code === 'unknown-accounts'));
  assert.ok(c.blocking.some((b) => b.code === 'control-differs' && b.control === 'AR'));
  assert.ok(c.blocking.some((b) => b.code === 'stock-differs'));
  assert.match(c.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(canGoLive(c, { confirmed: true, contentSha256: c.contentSha256 }).ok, false, 'blocked stays blocked');
  const ok = { ...c, status: 'differences-routed-to-suspense', blocking: [] };
  assert.equal(canGoLive(ok, undefined).ok, false);
  assert.equal(canGoLive(ok, { confirmed: true, contentSha256: 'deadbeef' }).ok, false, 'approval of a different certificate');
  assert.equal(canGoLive(ok, { confirmed: true, contentSha256: ok.contentSha256 }).ok, false, 'suspense must be accepted explicitly');
  assert.equal(canGoLive(ok, { confirmed: true, contentSha256: ok.contentSha256, acceptsSuspense: true }).ok, true);
});
