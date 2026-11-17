import * as fs from 'fs';
import * as path from 'path';
import { parseCamt053 } from './camt053.parser';
import { parseMt940 } from './mt940.parser';
import { detectFormat, parseStatement } from './statement-parse';
import { StatementParseError } from './statement.types';
import { parseXml } from './xml-lite';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

const camt = (entries: string, stmtExtra = '') => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Id>S1</Id>
<Acct><Id><Othr><Id>123456</Id></Othr></Id><Ccy>EUR</Ccy></Acct>${stmtExtra}${entries}</Stmt></BkToCstmrStmt></Document>`;

describe('CAMT.053 parser', () => {
  it('reads the Test 9 fixture: ids, amounts, dates, direction, remittance, counterparty', () => {
    const s = parseCamt053(fixture('camt053-test9.xml'));
    expect(s).toMatchObject({ format: 'camt053', statementId: 'STMT-0001', accountRef: 'DE89370400440532013000', currency: 'EUR' });
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]).toEqual({
      bankTxnId: 'TX-1',
      bookingDate: '2026-11-02',
      valueDate: '2026-11-02',
      amountMinor: 119000n,
      direction: 'credit',
      currency: 'EUR',
      reference: 'Payment for INV-101',
      counterparty: 'Acme GmbH',
    });
    expect(s.lines[1]).toMatchObject({ bankTxnId: 'TX-2', amountMinor: 97000n, reference: 'INV-102 INV-103 net of 30.00 bank fee', counterparty: 'Beta & Co' });
  });

  it('uses NtryRef when AcctSvcrRef is absent, and flips a reversal', () => {
    const s = parseCamt053(
      camt(`<Ntry><NtryRef>R1</NtryRef><Amt Ccy="EUR">10.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd>
        <Sts><Cd>BOOK</Cd></Sts><BookgDt><DtTm>2026-01-05T10:00:00</DtTm></BookgDt></Ntry>`),
    );
    expect(s.lines).toEqual([
      expect.objectContaining({ bankTxnId: 'R1', direction: 'debit', amountMinor: 1050n, bookingDate: '2026-01-05', valueDate: null }),
    ]);
  });

  it('skips entries that are not booked', () => {
    const s = parseCamt053(
      camt(`<Ntry><Amt Ccy="EUR">1</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-01-05</Dt></BookgDt><AcctSvcrRef>P</AcctSvcrRef></Ntry>
            <Ntry><Amt Ccy="EUR">2</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-01-05</Dt></BookgDt><AcctSvcrRef>B</AcctSvcrRef></Ntry>`),
    );
    expect(s.lines.map((l) => l.bankTxnId)).toEqual(['B']);
    expect(s.lines[0].direction).toBe('debit');
  });

  it('splits a batch entry into one line per TxDtls when the details add up', () => {
    const s = parseCamt053(
      camt(`<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-01</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls><Amt Ccy="EUR">100.00</Amt><RmtInf><Ustrd>INV-1</Ustrd></RmtInf></TxDtls>
          <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">200.00</Amt></TxAmt></AmtDtls><RmtInf><Ustrd>INV-2</Ustrd></RmtInf></TxDtls>
        </NtryDtls></Ntry>`),
    );
    expect(s.lines.map((l) => [l.bankTxnId, l.amountMinor, l.reference])).toEqual([
      ['B1/1', 10000n, 'INV-1'],
      ['B1/2', 20000n, 'INV-2'],
    ]);
  });

  it('keeps one line when the TxDtls amounts do not add up to the entry', () => {
    const s = parseCamt053(
      camt(`<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-01</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
        <NtryDtls><TxDtls><Amt Ccy="EUR">100.00</Amt></TxDtls><TxDtls><Amt Ccy="EUR">100.00</Amt></TxDtls></NtryDtls></Ntry>`),
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ bankTxnId: 'B1', amountMinor: 30000n });
  });

  it('gives the same stable id to an entry without any reference, and numbers true duplicates', () => {
    const entry = `<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-01</Dt></BookgDt></Ntry>`;
    const a = parseCamt053(camt(entry + entry));
    const b = parseCamt053(camt(entry + entry));
    expect(a.lines[0].bankTxnId).toMatch(/^syn-[0-9a-f]{24}$/);
    expect(a.lines[1].bankTxnId).toBe(`${a.lines[0].bankTxnId}#2`);
    expect(b.lines.map((l) => l.bankTxnId)).toEqual(a.lines.map((l) => l.bankTxnId));
  });

  it('rejects malformed input: bad indicator, bad amount, missing date, not CAMT, DOCTYPE/ENTITY', () => {
    const base = (inner: string) => camt(`<Ntry>${inner}</Ntry>`);
    expect(() => parseCamt053(base('<Amt Ccy="EUR">1</Amt><CdtDbtInd>X</CdtDbtInd>'))).toThrow(StatementParseError);
    expect(() => parseCamt053(base('<Amt Ccy="EUR">1.234</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-01-01</Dt></BookgDt>'))).toThrow(/amount/i);
    expect(() => parseCamt053(base('<Amt Ccy="EUR">1</Amt><CdtDbtInd>CRDT</CdtDbtInd>'))).toThrow(/booking date/);
    expect(() => parseCamt053('<a><b/></a>')).toThrow(/no <Stmt>/);
    expect(() => parseCamt053('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Stmt/>')).toThrow(/DOCTYPE/);
    expect(() => parseXml('<a><b></a>')).toThrow(StatementParseError);
    expect(() => parseXml('<a>')).toThrow(/unclosed/);
  });
});

describe('MT940 parser', () => {
  it('reads the Test 9 fixture: bank refs, amounts, dates, structured :86:', () => {
    const s = parseMt940(fixture('mt940-test9.txt'));
    expect(s).toMatchObject({ format: 'mt940', statementId: 'STMT-0001', accountRef: 'DE89370400440532013000', currency: 'EUR' });
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]).toEqual({
      bankTxnId: 'TX-1',
      bookingDate: '2026-11-02',
      valueDate: '2026-11-02',
      amountMinor: 119000n,
      direction: 'credit',
      currency: 'EUR',
      reference: 'Payment for INV-101',
      counterparty: 'Acme GmbH',
    });
    expect(s.lines[1]).toMatchObject({ bankTxnId: 'TX-2', amountMinor: 97000n, reference: 'INV-102 INV-103 net of 30.00 bank fee', counterparty: 'Beta & Co' });
  });

  it('handles debit, reversal marks, entry date across the year end, and multi-line :86:', () => {
    const s = parseMt940(`:20:X
:25:123456
:60F:C261230EUR0,00
:61:2612300102D50,25NCHKNONREF
:86:Check 42
payment to supplier
:61:261231RC10,00NTRFREF1//B2
:62F:C260102EUR0,00`);
    expect(s.lines[0]).toMatchObject({ direction: 'debit', amountMinor: 5025n, valueDate: '2026-12-30', bookingDate: '2027-01-02', reference: 'Check 42 payment to supplier' });
    expect(s.lines[0].bankTxnId).toMatch(/^syn-/);
    expect(s.lines[1]).toMatchObject({ direction: 'debit', bankTxnId: 'B2', reference: 'REF1' });
    const rd = parseMt940(':20:X\n:61:261231RD10,00NTRFNONREF//B3\n');
    expect(rd.lines[0].direction).toBe('credit');
  });

  it('is stable across re-imports and across overlapping statements (no statement number in the id)', () => {
    const body = (n: string) => `:20:A\n:25:123\n:28C:${n}\n:61:2611020102C10,00NTRFNONREF\n:86:abc\n`;
    expect(parseMt940(body('1/1')).lines[0].bankTxnId).toBe(parseMt940(body('2/1')).lines[0].bankTxnId);
  });

  it('rejects an invalid :61:, a bad date, a zero amount and non-MT940 text', () => {
    expect(() => parseMt940(':20:X\n:61:garbage\n')).toThrow(/Invalid :61:/);
    expect(() => parseMt940(':20:X\n:61:2613320102C1,00NTRFX\n')).toThrow(/invalid date/);
    expect(() => parseMt940(':20:X\n:61:261102C0,00NTRFX\n')).toThrow(/positive/);
    expect(() => parseMt940('hello')).toThrow(/Not an MT940/);
  });
});

describe('format detection', () => {
  it('detects XML and MT940, optionally with a BOM or SWIFT block headers', () => {
    expect(detectFormat(`﻿  ${fixture('camt053-test9.xml')}`)).toBe('camt053');
    expect(detectFormat(fixture('mt940-test9.txt'))).toBe('mt940');
    expect(detectFormat('{1:F01BANKDEFFAXXX}{2:O940}{4:\n:20:X\n:61:2611020102C1,00NTRFX\n-}')).toBe('mt940');
    expect(() => detectFormat('a,b,c\n1,2,3')).toThrow(StatementParseError);
  });

  it('parseStatement dispatches on detection or on the explicit format', () => {
    expect(parseStatement(fixture('camt053-test9.xml')).lines).toHaveLength(2);
    expect(parseStatement(fixture('mt940-test9.txt'), 'mt940').lines).toHaveLength(2);
  });

  it('money is exact: 0.10 + 0.20 style values never touch floats', () => {
    const s = parseMt940(':20:X\n:61:261102C12345678901234,56NTRFX//Z\n');
    expect(s.lines[0].amountMinor).toBe(1234567890123456n);
  });
});
