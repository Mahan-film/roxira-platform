import { encodeCp1252 } from './cp1252';
import { DatevExtfService } from './datev-extf.service';
import {
  exportBuchungsstapel,
  exportDebitorenKreditoren,
  exportSachkontenbeschriftungen,
  formatBelegdatumTtmm,
  sanitiseBelegfeld1,
  validateDatevExtfFile,
} from './extf700';

describe('T189 DATEV EXTF 700 export', () => {
  const service = new DatevExtfService();
  const baseConfig = {
    consultantNumber: '1001',
    clientNumber: '42',
    fiscalYearStart: '2026-01-01',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
  };

  it('exports Buchungsstapel (cat 21, v13), Debitoren/Kreditoren (cat 16, v5), and Sachkontenbeschriftungen (cat 20, v3)', () => {
    const postings = service.exportPostings(
      [
        {
          amount: '119.00',
          debitCredit: 'S',
          account: '10000',
          contraAccount: '8400',
          date: '2026-01-15',
          documentRef1: 'RE-2026-001',
          text: 'Büromaterial €',
        },
      ],
      { ...baseConfig, encoding: 'utf8-bom' },
    );
    expect(postings.category).toBe(21);
    expect(postings.files).toHaveLength(1);
    expect(validateDatevExtfFile(postings.files[0].buffer, 'utf8-bom')).toEqual({
      valid: true,
      errors: [],
      category: 21,
      dataRowCount: 1,
    });

    const parties = service.exportParties(
      [{ account: '10000', name: 'Müller GmbH', city: 'München', country: 'DE', vatId: 'DE123456789' }],
      { ...baseConfig, encoding: 'cp1252' },
    );
    expect(parties.category).toBe(16);
    expect(validateDatevExtfFile(parties.files[0].buffer, 'cp1252')).toEqual({
      valid: true,
      errors: [],
      category: 16,
      dataRowCount: 1,
    });

    const labels = service.exportAccountLabels(
      [{ account: '8400', label: 'Erlöse 19% USt' }],
      { ...baseConfig, encoding: 'cp1252' },
    );
    expect(labels.category).toBe(20);
    expect(validateDatevExtfFile(labels.files[0].buffer, 'cp1252')).toEqual({
      valid: true,
      errors: [],
      category: 20,
      dataRowCount: 1,
    });
  });

  it('encodes CP1252 with Windows-1252 € (0x80) and umlauts, and UTF-8 with BOM', () => {
    const buf = encodeCp1252('Müller €');
    expect(buf[1]).toBe(0xfc); // ü in CP1252
    expect(buf[buf.length - 1]).toBe(0x80); // € in CP1252

    const utf8 = exportSachkontenbeschriftungen(
      [{ account: '4900', label: 'Sonstige Kosten €' }],
      { ...baseConfig, encoding: 'utf8-bom' },
    );
    expect(utf8.files[0].buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('sanitises Belegfeld 1 to [\\w$&%*+\\-/]{0,36}', () => {
    expect(sanitiseBelegfeld1('  RE 2026 / Müller #99 (final)!  ')).toBe('RE-2026-/-Mueller-99-final');
    expect(sanitiseBelegfeld1('A'.repeat(50))).toHaveLength(36);
  });

  it('handles non-calendar fiscal years and rejects out-of-year dates', () => {
    expect(formatBelegdatumTtmm('2027-02-15', '2026-04-01')).toBe('1502');
    expect(() => formatBelegdatumTtmm('2026-03-31', '2026-04-01')).toThrow();

    const res = exportBuchungsstapel(
      [
        {
          amount: '250.50',
          debitCredit: 'S',
          account: '1200',
          contraAccount: '4980',
          date: '2027-02-15',
          documentRef1: 'INV-2027-1',
        },
      ],
      {
        ...baseConfig,
        fiscalYearStart: '2026-04-01',
        periodStart: '2027-02-01',
        periodEnd: '2027-02-28',
      },
    );
    const text = res.files[0].buffer.subarray(3).toString('utf8');
    expect(text).toContain(';20260401;');
    expect(text).toContain(';1502;');
  });

  it('fills foreign-currency fields (WKZ Umsatz, Kurs, Basis-Umsatz, WKZ Basis-Umsatz) and rejects 0,00', () => {
    const res = exportBuchungsstapel(
      [
        {
          amount: '100.00',
          debitCredit: 'S',
          currency: 'USD',
          exchangeRate: '1.085000',
          baseAmount: '92.17',
          account: '10000',
          contraAccount: '8400',
          date: '2026-01-20',
          documentRef1: 'USD-1',
        },
      ],
      baseConfig,
    );
    const lines = res.files[0].buffer.subarray(3).toString('utf8').split('\r\n');
    const cols = lines[2].split(';');
    expect(cols[0]).toBe('100,00');
    expect(cols[2]).toBe('"USD"');
    expect(cols[3]).toBe('1,085000');
    expect(cols[4]).toBe('92,17');
    expect(cols[5]).toBe('"EUR"');

    expect(() =>
      exportBuchungsstapel(
        [{ amount: '0.00', debitCredit: 'S', account: '10000', contraAccount: '8400', date: '2026-01-20' }],
        baseConfig,
      ),
    ).toThrow(/0,00/);
  });

  it('splits a 105,000-row export into two 99,999-max files accepted by DATEV validation', () => {
    const rows = Array.from({ length: 105_000 }, (_, i) => ({
      amount: '10.00',
      debitCredit: 'S' as const,
      account: '1200',
      contraAccount: '4980',
      date: '2026-01-10',
      documentRef1: `DOC-${i + 1}`,
    }));
    const res = exportBuchungsstapel(rows, { ...baseConfig, encoding: 'cp1252' });
    expect(res.totalRows).toBe(105_000);
    expect(res.files).toHaveLength(2);
    expect(res.files[0].rowCount).toBe(99_999);
    expect(res.files[1].rowCount).toBe(5_001);

    const v1 = validateDatevExtfFile(res.files[0].buffer, 'cp1252');
    const v2 = validateDatevExtfFile(res.files[1].buffer, 'cp1252');
    expect(v1).toEqual({ valid: true, errors: [], category: 21, dataRowCount: 99_999 });
    expect(v2).toEqual({ valid: true, errors: [], category: 21, dataRowCount: 5_001 });
  });
});
