/**
 * Migration reconciliation certificate (data only; the PDF is rendered by enterprise_hub from this JSON).
 * Inputs are the typed staging Parquet files from stage.mjs. All amounts are integer rials (strings), rounded half away
 * from zero from the DECIMAL(28,4) staging values; differences are computed on those rounded figures, so "to the rial"
 * is exact. Nothing here writes to the ledger.
 *
 * 1. Trial balance: source trial balance (target gl_trial_balance) vs the ledger the staged vouchers would produce
 *    (gl_lines). Per-account differences are routed to the opening-balance suspense account, with the source documents
 *    that could explain each one (unbalanced vouchers) named.
 * 2. AR/AP subledger totals and cheques in transit vs the control accounts the customer designates.
 * 3. Stock: per item and warehouse quantity and FIFO value of the staged movements vs the source stock balances;
 *    negative source stock listed with a proposed adjustment.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { qstr, rows } from './transform.mjs';

export const SUSPENSE = { code: 'OB-SUSPENSE', nameFa: 'حساب واسط توازن افتتاحیه' };
const SCALE = 10_000n;
/** Status text that means the cheque is no longer in transit. 'در جریان وصول' (being collected) must NOT match; unknown statuses count as in transit. */
const CLEARED_RE = '(وصول\\s*شده|پاس|برگشت|باطل|نقد\\s*شده|cleared|paid|passed|returned|cancel)';
/** "-1.000000" -> "-1", "2.500000" -> "2.5". */
const trimNum = (t) => (t === null || t === undefined ? t : String(t).includes('.') ? String(t).replace(/0+$/, '').replace(/\.$/, '') : String(t));

/** "12345.6789" -> 123456789n (scaled 1e4). */
export function parseScaled4(text) {
  if (text === null || text === undefined || text === '') return 0n;
  const neg = String(text).startsWith('-');
  const [i, f = ''] = String(text).replace('-', '').split('.');
  const v = BigInt(i || '0') * SCALE + BigInt((f + '0000').slice(0, 4));
  return neg ? -v : v;
}
/** Rounds a 1e4-scaled value to whole rials, half away from zero. */
export function roundRial(scaled) {
  const neg = scaled < 0n;
  const a = neg ? -scaled : scaled;
  const r = (a + SCALE / 2n) / SCALE;
  return neg ? -r : r;
}
const rial = (text) => roundRial(parseScaled4(text));

const filesOf = (dir, target) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${target}__`) && f.endsWith('.parquet')).map((f) => path.join(dir, f)) : []);
const glob = (files) => `read_parquet([${files.map(qstr).join(',')}])`;

async function trialBalance(conn, stagedDir) {
  const tbFiles = filesOf(stagedDir, 'gl_trial_balance');
  const lineFiles = filesOf(stagedDir, 'gl_lines');
  const source = new Map();
  if (tbFiles.length) {
    for (const r of await rows(conn, `SELECT account_code AS c, sum(debit)::VARCHAR AS d, sum(credit)::VARCHAR AS k FROM ${glob(tbFiles)} GROUP BY 1`)) source.set(r.c, rial(r.d) - rial(r.k));
  }
  const migrated = new Map();
  let unbalanced = [];
  let linesTotal = { debit: 0n, credit: 0n };
  const accountsKnown = new Set((await (async () => { const f = filesOf(stagedDir, 'gl_accounts'); return f.length ? rows(conn, `SELECT DISTINCT code AS c FROM ${glob(f)}`) : []; })()).map((r) => r.c));
  const unknownAccounts = [];
  if (lineFiles.length) {
    for (const r of await rows(conn, `SELECT account_code AS c, coalesce(sum(debit),0)::VARCHAR AS d, coalesce(sum(credit),0)::VARCHAR AS k FROM ${glob(lineFiles)} GROUP BY 1`)) {
      const d = rial(r.d), k = rial(r.k);
      migrated.set(r.c, d - k);
      linesTotal = { debit: linesTotal.debit + d, credit: linesTotal.credit + k };
      if (accountsKnown.size && !accountsKnown.has(r.c)) unknownAccounts.push({ account: r.c, net: String(d - k) });
    }
    unbalanced = (await rows(conn, `SELECT voucher_no AS v, src_table AS t, min(src_row)::VARCHAR AS first_row, sum(debit)::VARCHAR AS d, sum(credit)::VARCHAR AS k, list(DISTINCT account_code) AS accounts FROM ${glob(lineFiles)} GROUP BY voucher_no, src_table HAVING round(coalesce(sum(debit),0) - coalesce(sum(credit),0), 0) <> 0`))
      .map((r) => ({ voucher: r.v, sourceTable: r.t, firstRow: Number(r.first_row), difference: String(rial(r.d) - rial(r.k)), accounts: r.accounts ?? [] }));
  }
  const codes = [...new Set([...source.keys(), ...migrated.keys()])].sort();
  const accounts = [];
  let suspense = 0n;
  for (const code of codes) {
    const s = source.get(code) ?? 0n;
    const m = migrated.get(code) ?? 0n;
    const diff = s - m;
    if (source.size && diff !== 0n) {
      suspense -= diff;
      const suspects = unbalanced.filter((u) => u.accounts.includes(code)).slice(0, 5).map((u) => ({ sourceTable: u.sourceTable, voucher: u.voucher, firstRow: u.firstRow, voucherDifference: u.difference }));
      accounts.push({ account: code, source: String(s), migrated: String(m), difference: String(diff), suspectDocuments: suspects });
    }
  }
  return {
    sourceTrialBalanceProvided: source.size > 0,
    accountsCompared: codes.length,
    accountsWithDifference: accounts.length,
    migratedTotals: { debit: String(linesTotal.debit), credit: String(linesTotal.credit), balanced: linesTotal.debit === linesTotal.credit },
    differences: accounts,
    suspense: { ...SUSPENSE, amount: String(suspense), note: 'Each account difference is posted to its account and the opposite entry to this account, so the opening trial balance equals the source to the rial.' },
    unbalancedVouchers: unbalanced.slice(0, 200),
    unbalancedVoucherCount: unbalanced.length,
    unknownAccounts,
  };
}

async function netOf(conn, stagedDir, codes) {
  if (!codes?.length) return null;
  const lines = filesOf(stagedDir, 'gl_lines');
  const tb = filesOf(stagedDir, 'gl_trial_balance');
  const list = codes.map(qstr).join(',');
  const f = tb.length ? tb : lines;
  if (!f.length) return null;
  const [r] = await rows(conn, `SELECT coalesce(sum(debit),0)::VARCHAR AS d, coalesce(sum(credit),0)::VARCHAR AS k FROM ${glob(f)} WHERE account_code IN (${list})`);
  return rial(r.d) - rial(r.k);
}

async function subledgers(conn, stagedDir, control) {
  const out = { openItems: null, cheques: null };
  const oi = filesOf(stagedDir, 'open_items');
  if (oi.length) {
    const r = await rows(conn, `SELECT lower(coalesce(kind, CASE WHEN amount < 0 THEN 'ap' ELSE 'ar' END)) AS k, sum(abs(amount))::VARCHAR AS total, count(*)::VARCHAR AS n, count(*) FILTER (WHERE kind IS NULL)::VARCHAR AS inferred, count(DISTINCT party_code)::VARCHAR AS parties FROM ${glob(oi)} GROUP BY 1`);
    const by = Object.fromEntries(r.map((x) => [x.k === 'ap' ? 'ap' : 'ar', { total: String(rial(x.total)), items: Number(x.n), parties: Number(x.parties), kindInferred: Number(x.inferred) }]));
    const arNet = await netOf(conn, stagedDir, control?.ar);
    const apNet = await netOf(conn, stagedDir, control?.ap);
    out.openItems = {
      ar: by.ar ?? { total: '0', items: 0, parties: 0, kindInferred: 0 },
      ap: by.ap ?? { total: '0', items: 0, parties: 0, kindInferred: 0 },
      controlAr: arNet === null ? null : { accounts: control.ar, ledgerBalance: String(arNet), difference: String(arNet - BigInt(by.ar?.total ?? 0)) },
      controlAp: apNet === null ? null : { accounts: control.ap, ledgerBalance: String(-apNet), difference: String(-apNet - BigInt(by.ap?.total ?? 0)) },
    };
  }
  const ch = filesOf(stagedDir, 'cheques');
  if (ch.length) {
    const notCleared = `NOT regexp_matches(coalesce(lower(status),''), ${qstr(CLEARED_RE)})`;
    const r = await rows(conn, `SELECT lower(coalesce(direction,'receivable')) AS dir, sum(amount)::VARCHAR AS total, count(*)::VARCHAR AS n FROM ${glob(ch)} WHERE ${notCleared} GROUP BY 1`);
    const by = Object.fromEntries(r.map((x) => [x.dir.startsWith('pay') ? 'payable' : 'receivable', { total: String(rial(x.total)), count: Number(x.n) }]));
    const rec = await netOf(conn, stagedDir, control?.chequesReceivable);
    const pay = await netOf(conn, stagedDir, control?.chequesPayable);
    out.cheques = {
      receivable: by.receivable ?? { total: '0', count: 0 },
      payable: by.payable ?? { total: '0', count: 0 },
      controlReceivable: rec === null ? null : { accounts: control.chequesReceivable, ledgerBalance: String(rec), difference: String(rec - BigInt(by.receivable?.total ?? 0)) },
      controlPayable: pay === null ? null : { accounts: control.chequesPayable, ledgerBalance: String(-pay), difference: String(-pay - BigInt(by.payable?.total ?? 0)) },
    };
  }
  return out;
}

async function stock(conn, stagedDir) {
  const mv = filesOf(stagedDir, 'stock_moves');
  if (!mv.length) return null;
  // Signed quantity: direction wins, else the sign of qty. Layers are consumed oldest first (FIFO).
  const base = `SELECT item_code, warehouse, src_row, date, unit_cost, CASE WHEN direction = 'out' THEN -abs(qty) WHEN direction = 'in' THEN abs(qty) ELSE qty END AS q FROM ${glob(mv)}`;
  const computed = await rows(conn, `
    WITH m AS (${base}),
    outs AS (SELECT item_code, warehouse, sum(-q) AS out_q FROM m WHERE q < 0 GROUP BY 1, 2),
    ins AS (SELECT item_code, warehouse, q, coalesce(unit_cost, 0) AS c,
              sum(q) OVER (PARTITION BY item_code, warehouse ORDER BY date NULLS FIRST, src_row ROWS UNBOUNDED PRECEDING) AS cin FROM m WHERE q > 0),
    layers AS (SELECT i.item_code, i.warehouse, i.q, i.c, i.cin, coalesce(o.out_q, 0) AS out_q FROM ins i LEFT JOIN outs o USING (item_code, warehouse)),
    val AS (SELECT item_code, warehouse, sum(q) AS in_q, max(out_q) AS out_q,
              sum(greatest(0, cin - greatest(out_q, cin - q)) * c) AS fifo FROM layers GROUP BY 1, 2),
    run AS (SELECT item_code, warehouse, min(rb) AS min_bal, any_value(last_cost) AS last_cost FROM (
              SELECT item_code, warehouse, sum(q) OVER (PARTITION BY item_code, warehouse ORDER BY date NULLS FIRST, src_row ROWS UNBOUNDED PRECEDING) AS rb,
                     last_value(unit_cost IGNORE NULLS) OVER (PARTITION BY item_code, warehouse ORDER BY date NULLS FIRST, src_row ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_cost FROM m) GROUP BY 1, 2),
    keys AS (SELECT item_code, warehouse FROM m GROUP BY 1, 2)
    SELECT k.item_code, k.warehouse, (coalesce(v.in_q, 0) - coalesce(o.out_q, 0))::VARCHAR AS qty, coalesce(v.fifo, 0)::VARCHAR AS fifo,
           r.min_bal::VARCHAR AS min_bal, r.last_cost::VARCHAR AS last_cost
    FROM keys k LEFT JOIN val v USING (item_code, warehouse) LEFT JOIN outs o USING (item_code, warehouse) LEFT JOIN run r USING (item_code, warehouse)`);
  const balFiles = filesOf(stagedDir, 'stock_balances');
  const source = new Map();
  if (balFiles.length) for (const r of await rows(conn, `SELECT item_code, warehouse, sum(qty)::VARCHAR AS q, sum(value)::VARCHAR AS v, count(value)::VARCHAR AS hv FROM ${glob(balFiles)} GROUP BY 1, 2`)) source.set(`${r.item_code}\u0000${r.warehouse}`, { q: parseScaled4(r.q), v: Number(r.hv) ? rial(r.v) : null });
  const differences = [];
  const negatives = [];
  let sourceOnly = 0;
  const seen = new Set();
  for (const c of computed) {
    const key = `${c.item_code}\u0000${c.warehouse}`;
    seen.add(key);
    const qty = parseScaled4(c.qty);
    const fifo = rial(c.fifo);
    const s = source.get(key);
    if (s) {
      const qd = qty - s.q;
      const vd = s.v === null ? null : fifo - s.v;
      if (qd !== 0n || (vd !== null && vd !== 0n)) differences.push({ item: c.item_code, warehouse: c.warehouse, qtyComputed: trimNum(c.qty), qtySource: String(Number(s.q) / 1e4), valueComputed: String(fifo), valueSource: s.v === null ? null : String(s.v), qtyDifference: String(Number(qd) / 1e4), valueDifference: vd === null ? null : String(vd) });
    }
    const endNeg = qty < 0n;
    if (endNeg || (c.min_bal !== null && parseScaled4(c.min_bal) < 0n)) {
      const needed = parseScaled4(c.min_bal) < 0n ? -parseScaled4(c.min_bal) : 0n;
      negatives.push({ item: c.item_code, warehouse: c.warehouse, endingQty: trimNum(c.qty), lowestRunningQty: trimNum(c.min_bal), proposedAdjustmentQty: String(Number(needed) / 1e4), atUnitCost: trimNum(c.last_cost) ?? null, note: endNeg ? 'ends negative' : 'went negative before later receipts' });
    }
  }
  for (const k of source.keys()) if (!seen.has(k)) sourceOnly += 1;
  return { itemWarehousePairs: computed.length, sourceBalancesProvided: source.size > 0, differences: differences.slice(0, 500), differenceCount: differences.length, negativeStock: negatives.slice(0, 500), negativeCount: negatives.length, sourceOnlyPairs: sourceOnly, valuation: 'FIFO' };
}

async function rejectsReport(conn, rejectDir) {
  if (!fs.existsSync(rejectDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(rejectDir).filter((x) => x.endsWith('.parquet'))) {
    const [r] = await rows(conn, `SELECT count(*)::VARCHAR AS n, list(DISTINCT src_table) AS t, min(src_row)::VARCHAR AS first FROM read_parquet(${qstr(path.join(rejectDir, f))})`);
    if (Number(r.n) > 0) out.push({ target: f.split('__')[0], sourceTables: r.t, rows: Number(r.n), firstRow: Number(r.first) });
  }
  return out;
}

/**
 * @param control  { ar, ap, chequesReceivable, chequesPayable }: arrays of ledger account codes the customer designates.
 */
export async function buildCertificate({ conn, outDir, tenantId, sourceName, control = {}, generatedAt = new Date().toISOString() }) {
  const stagedDir = path.join(outDir, 'staged');
  const rejectDir = path.join(outDir, 'rejects');
  const tb = await trialBalance(conn, stagedDir);
  const sub = await subledgers(conn, stagedDir, control);
  const st = await stock(conn, stagedDir);
  const rej = await rejectsReport(conn, rejectDir);

  const blocking = [];
  if (!tb.sourceTrialBalanceProvided) blocking.push({ code: 'no-source-tb', message: 'No source trial balance was found, so the trial balance cannot be proven to the rial.' });
  if (!tb.migratedTotals.balanced) blocking.push({ code: 'lines-unbalanced', message: 'The migrated ledger lines are not balanced (total debit differs from total credit).' });
  if (tb.unknownAccounts.length) blocking.push({ code: 'unknown-accounts', count: tb.unknownAccounts.length, message: `${tb.unknownAccounts.length} account code(s) used in vouchers are missing from the chart of accounts.` });
  for (const [name, c] of [['AR', sub.openItems?.controlAr], ['AP', sub.openItems?.controlAp], ['receivable cheques', sub.cheques?.controlReceivable], ['payable cheques', sub.cheques?.controlPayable]]) {
    if (c && c.difference !== '0') blocking.push({ code: 'control-differs', control: name, difference: c.difference, message: `${name} subledger differs from its control account by ${c.difference} rial.` });
  }
  if (st && st.differenceCount > 0) blocking.push({ code: 'stock-differs', count: st.differenceCount, message: `${st.differenceCount} item/warehouse pair(s) differ from the source stock balances.` });
  const body = {
    version: 1,
    tenantId,
    source: sourceName ?? null,
    generatedAt,
    currency: 'IRR',
    trialBalance: tb,
    subledgers: sub,
    stock: st,
    rejectedRows: rej,
    blocking,
    status: blocking.length === 0 ? (tb.accountsWithDifference === 0 ? 'clean' : 'differences-routed-to-suspense') : 'blocked',
    approval: { required: true, status: 'pending' },
  };
  const contentSha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, contentSha256 };
}

/** Nothing may go live until the customer approved THIS certificate (same hash) and nothing blocks it. */
export function canGoLive(certificate, approval) {
  if (!certificate || certificate.status === 'blocked') return { ok: false, reason: 'certificate is blocked' };
  if (!approval?.confirmed || approval.contentSha256 !== certificate.contentSha256) return { ok: false, reason: 'the customer has not approved this exact certificate' };
  if (certificate.status === 'differences-routed-to-suspense' && !approval.acceptsSuspense) return { ok: false, reason: 'the customer has not accepted the amounts routed to the suspense account' };
  return { ok: true };
}
