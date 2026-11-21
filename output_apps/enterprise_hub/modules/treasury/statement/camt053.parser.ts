import { createHash } from 'crypto';
import { MoneyFormatError, parseMinor } from '../../accounting/money';
import { ParsedStatement, ParsedStatementLine, StatementParseError } from './statement.types';
import { child, children, descendants, parseXml, textAt, XmlNode } from './xml-lite';

/** The part of an ISO 8601 date or date-time that is the calendar day. */
function dayOf(node: XmlNode | undefined): string | null {
  const raw = textAt(node, 'Dt') ?? textAt(node, 'DtTm');
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : null;
}

function amountOf(node: XmlNode | undefined, what: string): { minor: bigint; currency: string | null } {
  const raw = node?.text.trim();
  if (!raw) throw new StatementParseError(`${what}: amount is missing.`);
  try {
    return { minor: parseMinor(raw), currency: node?.attrs.Ccy ?? null };
  } catch (e) {
    if (e instanceof MoneyFormatError) throw new StatementParseError(`${what}: ${e.message}`);
    throw e;
  }
}

const synthetic = (...parts: string[]): string =>
  `syn-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`;

/** Free-text part of an entry or one TxDtls: remittance lines, structured creditor reference, end-to-end id. */
function referenceText(node: XmlNode | undefined): string {
  if (!node) return '';
  const parts: string[] = [];
  for (const rmt of descendants(node, 'RmtInf')) {
    for (const u of children(rmt, 'Ustrd')) if (u.text.trim()) parts.push(u.text.trim());
    for (const s of children(rmt, 'Strd')) {
      const ref = textAt(s, 'CdtrRefInf', 'Ref');
      if (ref) parts.push(ref);
    }
  }
  const e2e = textAt(child(node, 'Refs'), 'EndToEndId');
  if (e2e && e2e !== 'NOTPROVIDED') parts.push(e2e);
  const addtl = textAt(node, 'AddtlTxInf');
  if (addtl) parts.push(addtl);
  return parts.join(' ');
}

function counterpartyOf(node: XmlNode | undefined, credit: boolean): string | null {
  if (!node) return null;
  const parties = child(node, 'RltdPties');
  return textAt(parties, credit ? 'Dbtr' : 'Cdtr', 'Nm') ?? textAt(parties, credit ? 'Dbtr' : 'Cdtr', 'Pty', 'Nm') ?? null;
}

/**
 * CAMT.053 (ISO 20022 bank-to-customer statement, any version 001.02 to 001.08). Reads every booked
 * entry of every statement: amount, CdtDbtInd (CRDT = credit, DBIT = debit; RvslInd flips it),
 * booking and value date, AcctSvcrRef / NtryRef as the bank transaction id and remittance text.
 * An entry with several TxDtls that each carry an amount (a batch) becomes one line per TxDtls
 * (`<id>/1`, `<id>/2`, ...), provided the amounts add up to the entry amount; otherwise one line.
 * Entries that are not booked (pending, information) are skipped.
 */
export function parseCamt053(xml: string): ParsedStatement {
  const doc = parseXml(xml);
  const stmts = descendants(doc, 'Stmt');
  if (stmts.length === 0) throw new StatementParseError('Not a CAMT.053 file: no <Stmt> element.');

  const lines: ParsedStatementLine[] = [];
  const seen = new Map<string, number>();
  let statementId: string | null = null;
  let accountRef: string | null = null;
  let currency: string | null = null;

  for (const stmt of stmts) {
    const stmtId = textAt(stmt, 'Id') ?? '';
    statementId ??= stmtId || null;
    const acct = child(stmt, 'Acct');
    accountRef ??= textAt(acct, 'Id', 'IBAN') ?? textAt(acct, 'Id', 'Othr', 'Id') ?? null;
    currency ??= textAt(acct, 'Ccy') ?? null;

    children(stmt, 'Ntry').forEach((ntry, entryIndex) => {
      // 001.02 has <Sts>BOOK</Sts>, newer versions <Sts><Cd>BOOK</Cd></Sts>.
      const statusCode = textAt(ntry, 'Sts') ?? textAt(ntry, 'Sts', 'Cd');
      if (statusCode && statusCode !== 'BOOK') return;

      const indicator = textAt(ntry, 'CdtDbtInd');
      if (indicator !== 'CRDT' && indicator !== 'DBIT') {
        throw new StatementParseError(`Entry ${entryIndex + 1}: CdtDbtInd must be CRDT or DBIT.`);
      }
      const reversal = textAt(ntry, 'RvslInd') === 'true';
      const credit = (indicator === 'CRDT') !== reversal;

      const total = amountOf(child(ntry, 'Amt'), `Entry ${entryIndex + 1}`);
      if (total.minor <= 0n) throw new StatementParseError(`Entry ${entryIndex + 1}: amount must be positive.`);
      const bookingDate = dayOf(child(ntry, 'BookgDt')) ?? dayOf(child(ntry, 'ValDt'));
      if (!bookingDate) throw new StatementParseError(`Entry ${entryIndex + 1}: booking date is missing.`);
      const valueDate = dayOf(child(ntry, 'ValDt'));

      const details = children(child(ntry, 'NtryDtls'), 'TxDtls');
      const entryRef = textAt(ntry, 'AcctSvcrRef') ?? textAt(ntry, 'NtryRef');
      const entryText = [textAt(ntry, 'AddtlNtryInf')].filter(Boolean).join(' ');

      type Part = { amount: bigint; id: string | undefined; text: string; party: string | null };
      let parts: Part[] = [];
      const detailAmounts = details.map((d) => child(d, 'Amt') ?? child(child(child(d, 'AmtDtls'), 'TxAmt'), 'Amt'));
      if (details.length > 1 && detailAmounts.every((a) => a)) {
        const split = details.map((d, i) => ({
          amount: amountOf(detailAmounts[i], `Entry ${entryIndex + 1} detail ${i + 1}`).minor,
          id: textAt(child(d, 'Refs'), 'AcctSvcrRef'),
          text: referenceText(d),
          party: counterpartyOf(d, credit),
        }));
        if (split.reduce((s, p) => s + p.amount, 0n) === total.minor) parts = split;
      }
      const split = parts.length > 1;
      if (!split) {
        const text = [...details.map((d) => referenceText(d)), entryText].filter(Boolean).join(' ');
        parts = [
          {
            amount: total.minor,
            id: undefined,
            text,
            party: details.map((d) => counterpartyOf(d, credit)).find((p) => p) ?? null,
          },
        ];
        if (!entryRef && details.length === 1) parts[0].id = textAt(child(details[0], 'Refs'), 'AcctSvcrRef');
      }

      parts.forEach((part, i) => {
        let id = split ? (entryRef ? `${entryRef}/${i + 1}` : part.id) : (entryRef ?? part.id);
        // no bank reference at all: a stable hash (no statement id or position, so overlapping statements still dedupe)
        if (!id) id = synthetic(accountRef ?? '', bookingDate, indicator, part.amount.toString(), part.text);
        if (id.length > 128) id = synthetic(id);
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n > 0) id = `${id}#${n + 1}`;
        lines.push({
          bankTxnId: id,
          bookingDate,
          valueDate,
          amountMinor: part.amount,
          direction: credit ? 'credit' : 'debit',
          currency: total.currency,
          reference: part.text,
          counterparty: part.party,
        });
      });
    });
  }
  return { format: 'camt053', statementId, accountRef, currency, lines };
}
