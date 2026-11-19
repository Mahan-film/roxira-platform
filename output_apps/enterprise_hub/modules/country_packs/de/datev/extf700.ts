import { encodeDatevBuffer, type DatevEncoding } from './cp1252';
import {
  DATEV_CATEGORIES,
  DATEV_EXTF_VERSION,
  DATEV_MAX_ROWS_PER_FILE,
  type DatevAccountLabelRow,
  type DatevExportFile,
  type DatevExportResult,
  type DatevHeaderConfig,
  type DatevPartyRow,
  type DatevPostingRow,
} from './datev-extf.types';

const BELEGFELD1_ALLOWED = /[^A-Za-z0-9_$&%*+\-/]/g;
const BELEGFELD1_REGEX = /^[A-Za-z0-9_$&%*+\-/]{0,36}$/;

/** Sanitises Belegfeld 1 to DATEV's allowed set `[\w$&%*+\-/]{0,36}` (ASCII). */
export function sanitiseBelegfeld1(raw?: string | null): string {
  if (!raw) return '';
  const folded = raw
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(BELEGFELD1_ALLOWED, '');
  return folded.slice(0, 36);
}

/** Sanitises free-text CSV fields (strips CR/LF, escapes quotes). */
export function csvText(raw: string | undefined | null, maxLen?: number): string {
  const cleaned = (raw ?? '').replace(/[\r\n]+/g, ' ').trim();
  const sliced = maxLen !== undefined ? cleaned.slice(0, maxLen) : cleaned;
  return `"${sliced.replace(/"/g, '""')}"`;
}

/** Formats a positive decimal string as German-locale DATEV number with comma decimal separator. */
export function formatDatevDecimal(raw: string, decimals = 2, allowZero = false): string {
  const normalized = raw.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid DATEV decimal amount: "${raw}"`);
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  const minor = BigInt(wholePart || '0') * scale + BigInt(paddedFrac || '0');
  if (negative) {
    throw new Error(`DATEV amount must be positive (use Soll/Haben): "${raw}"`);
  }
  if (!allowZero && minor === 0n) {
    throw new Error('DATEV EXTF 700 forbids 0,00 amounts in Buchungsstapel.');
  }
  const wholeOut = (minor / scale).toString();
  const fracOut = (minor % scale).toString().padStart(decimals, '0');
  return `${wholeOut},${fracOut}`;
}

function parseIsoDay(iso: string): { year: number; month: number; day: number; yyyymmdd: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) {
    throw new Error(`Invalid ISO date (expected YYYY-MM-DD): "${iso}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Non-existent calendar date: "${iso}"`);
  }
  return { year, month, day, yyyymmdd: `${match[1]}${match[2]}${match[3]}` };
}

function defaultFiscalYearEnd(startIso: string): string {
  const { year, month, day } = parseIsoDay(startIso);
  const end = new Date(Date.UTC(year + 1, month - 1, day - 1));
  return end.toISOString().slice(0, 10);
}

/** Converts YYYY-MM-DD to DATEV Belegdatum `TTMM` and validates it falls in the fiscal year. */
export function formatBelegdatumTtmm(
  dateIso: string,
  fiscalYearStartIso: string,
  fiscalYearEndIso?: string,
): string {
  const d = parseIsoDay(dateIso);
  const fyStart = parseIsoDay(fiscalYearStartIso);
  const fyEnd = parseIsoDay(fiscalYearEndIso ?? defaultFiscalYearEnd(fiscalYearStartIso));
  if (d.yyyymmdd < fyStart.yyyymmdd || d.yyyymmdd > fyEnd.yyyymmdd) {
    throw new Error(
      `Posting date ${dateIso} is outside fiscal year ${fiscalYearStartIso}..${fyEnd.yyyymmdd.slice(0, 4)}-${fyEnd.yyyymmdd.slice(4, 6)}-${fyEnd.yyyymmdd.slice(6, 8)}.`,
    );
  }
  return `${String(d.day).padStart(2, '0')}${String(d.month).padStart(2, '0')}`;
}

function formatExtfTimestamp(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}

function buildExtfHeaderLine(
  category: (typeof DATEV_CATEGORIES)[keyof typeof DATEV_CATEGORIES],
  config: DatevHeaderConfig,
  partIndex: number,
  totalParts: number,
): string {
  const fyStart = parseIsoDay(config.fiscalYearStart).yyyymmdd;
  const isPosting = category.code === DATEV_CATEGORIES.BUCHUNGSSTAPEL.code;
  const periodStart = isPosting && config.periodStart ? parseIsoDay(config.periodStart).yyyymmdd : '';
  const periodEnd = isPosting && config.periodEnd ? parseIsoDay(config.periodEnd).yyyymmdd : '';
  const accountLength = config.accountLength ?? 4;
  if (accountLength < 4 || accountLength > 8) {
    throw new Error(`Invalid DATEV Sachkontenlänge: ${accountLength} (must be 4..8)`);
  }
  const baseLabel = config.label?.trim() || 'Roxira Export';
  const batchLabel = totalParts > 1 ? `${baseLabel} (${partIndex}/${totalParts})` : baseLabel;
  const created = formatExtfTimestamp(config.createdAt ?? new Date());
  const baseCurrency = (config.baseCurrency ?? 'EUR').toUpperCase();

  const fields: string[] = [
    '"EXTF"',
    String(DATEV_EXTF_VERSION),
    String(category.code),
    csvText(category.name),
    String(category.formatVersion),
    created,
    '',
    csvText(config.origin ?? 'RX', 2),
    csvText(config.exportedBy ?? 'Roxira', 25),
    '""',
    config.consultantNumber.trim(),
    config.clientNumber.trim(),
    fyStart,
    String(accountLength),
    periodStart,
    periodEnd,
    csvText(batchLabel, 30),
    '""',
    isPosting ? '1' : '',
    isPosting ? '0' : '',
    isPosting ? '0' : '',
    isPosting ? csvText(baseCurrency, 3) : '""',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '""',
    '""',
  ];
  return fields.join(';');
}

const BUCHUNGSSTAPEL_COLUMNS = [
  'Umsatz (ohne Soll/Haben-Kz)',
  'Soll/Haben-Kennzeichen',
  'WKZ Umsatz',
  'Kurs',
  'Basis-Umsatz',
  'WKZ Basis-Umsatz',
  'Konto',
  'Gegenkonto (ohne BU-Schlüssel)',
  'BU-Schlüssel',
  'Belegdatum',
  'Belegfeld 1',
  'Belegfeld 2',
  'Skonto',
  'Buchungstext',
  'Postensperre',
  'Diverse Adressnummer',
  'Geschäftspartnerbank',
  'Sachverhalt',
  'Zinssperre',
  'Beleglink',
  'Beleginfo - Art 1',
  'Beleginfo - Inhalt 1',
  'KOST1 - Kostenstelle',
  'KOST2 - Kostenstelle',
  'Festschreibung',
] as const;

const DEBITOREN_KREDITOREN_COLUMNS = [
  'Konto',
  'Name (Adressattyp Unternehmen)',
  'Name (Adressattyp natürl. Person)',
  'Adressattyp',
  'Straße',
  'Postleitzahl',
  'Ort',
  'Land',
  'EU-USt-IdNr',
  'IBAN',
  'BIC',
] as const;

const SACHKONTEN_COLUMNS = [
  'Konto',
  'Kontenbeschriftung',
  'Sprach-ID',
] as const;

function chunkRows<T>(rows: readonly T[], maxPerFile = DATEV_MAX_ROWS_PER_FILE): T[][] {
  if (rows.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += maxPerFile) {
    chunks.push(rows.slice(i, i + maxPerFile));
  }
  return chunks;
}

function buildFiles<T>(
  category: (typeof DATEV_CATEGORIES)[keyof typeof DATEV_CATEGORIES],
  columns: readonly string[],
  rows: readonly T[],
  formatRow: (row: T) => string,
  config: DatevHeaderConfig,
  filePrefix: string,
): DatevExportResult {
  const encoding: DatevEncoding = config.encoding ?? 'utf8-bom';
  const chunks = chunkRows(rows, DATEV_MAX_ROWS_PER_FILE);
  const totalParts = chunks.length;

  const files: DatevExportFile[] = chunks.map((chunk, idx) => {
    const partIndex = idx + 1;
    const header = buildExtfHeaderLine(category, config, partIndex, totalParts);
    const colHeader = columns.join(';');
    const lines = [header, colHeader, ...chunk.map(formatRow)];
    const content = `${lines.join('\r\n')}\r\n`;
    const suffix = totalParts > 1 ? `_${partIndex}_of_${totalParts}` : '';
    return {
      fileName: `${filePrefix}${suffix}.csv`,
      partIndex,
      totalParts,
      rowCount: chunk.length,
      encoding,
      buffer: encodeDatevBuffer(content, encoding),
    };
  });

  return {
    category: category.code,
    categoryName: category.name,
    totalRows: rows.length,
    files,
  };
}

export function exportBuchungsstapel(
  rows: readonly DatevPostingRow[],
  config: DatevHeaderConfig,
): DatevExportResult {
  const baseCurrency = (config.baseCurrency ?? 'EUR').toUpperCase();
  return buildFiles(
    DATEV_CATEGORIES.BUCHUNGSSTAPEL,
    BUCHUNGSSTAPEL_COLUMNS,
    rows,
    (row) => {
      const amount = formatDatevDecimal(row.amount, 2, false);
      const txCurrency = (row.currency ?? baseCurrency).toUpperCase();
      const rowBaseCurrency = (row.baseCurrency ?? baseCurrency).toUpperCase();
      const isForeign = txCurrency !== rowBaseCurrency;

      let rate = '';
      let baseAmount = '';
      let wkzBase = '';
      if (isForeign) {
        if (!row.exchangeRate || !row.baseAmount) {
          throw new Error(
            `Foreign-currency posting (${txCurrency} -> ${rowBaseCurrency}) requires exchangeRate and baseAmount.`,
          );
        }
        rate = formatDatevDecimal(row.exchangeRate, 6, false);
        baseAmount = formatDatevDecimal(row.baseAmount, 2, false);
        wkzBase = csvText(rowBaseCurrency, 3);
      }

      const belegdatum = formatBelegdatumTtmm(
        row.date,
        config.fiscalYearStart,
        config.fiscalYearEnd,
      );
      const belegfeld1 = sanitiseBelegfeld1(row.documentRef1);
      const cols = [
        amount,
        csvText(row.debitCredit, 1),
        csvText(txCurrency, 3),
        rate,
        baseAmount,
        wkzBase,
        row.account.trim(),
        row.contraAccount.trim(),
        csvText(row.buKey ?? '', 4),
        belegdatum,
        csvText(belegfeld1, 36),
        csvText(row.documentRef2 ?? '', 12),
        '',
        csvText(row.text ?? '', 60),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        csvText(row.costCenter1 ?? '', 8),
        csvText(row.costCenter2 ?? '', 8),
        '0',
      ];
      return cols.join(';');
    },
    config,
    'EXTF_Buchungsstapel',
  );
}

export function exportDebitorenKreditoren(
  rows: readonly DatevPartyRow[],
  config: DatevHeaderConfig,
): DatevExportResult {
  return buildFiles(
    DATEV_CATEGORIES.DEBITOREN_KREDITOREN,
    DEBITOREN_KREDITOREN_COLUMNS,
    rows,
    (row) => {
      const addressType = row.addressType ?? '2';
      const companyName = addressType === '2' ? row.name : '';
      const personName = addressType === '1' ? row.name : '';
      const cols = [
        row.account.trim(),
        csvText(companyName, 50),
        csvText(personName, 30),
        csvText(addressType, 1),
        csvText(row.street ?? '', 36),
        csvText(row.postalCode ?? '', 10),
        csvText(row.city ?? '', 30),
        csvText(row.country ?? 'DE', 2),
        csvText(row.vatId ?? '', 15),
        csvText(row.iban ?? '', 34),
        csvText(row.bic ?? '', 11),
      ];
      return cols.join(';');
    },
    config,
    'EXTF_Debitoren_Kreditoren',
  );
}

export function exportSachkontenbeschriftungen(
  rows: readonly DatevAccountLabelRow[],
  config: DatevHeaderConfig,
): DatevExportResult {
  return buildFiles(
    DATEV_CATEGORIES.SACHKONTENBESCHRIFTUNGEN,
    SACHKONTEN_COLUMNS,
    rows,
    (row) => {
      const cols = [
        row.account.trim(),
        csvText(row.label, 40),
        csvText(row.languageId ?? 'de-DE', 5),
      ];
      return cols.join(';');
    },
    config,
    'EXTF_Sachkontenbeschriftungen',
  );
}

export interface DatevValidationResult {
  valid: boolean;
  errors: string[];
  category: number;
  dataRowCount: number;
}

/** Validates a generated EXTF 700 buffer against DATEV import rules. */
export function validateDatevExtfFile(
  buffer: Buffer,
  encoding: DatevEncoding,
): DatevValidationResult {
  const errors: string[] = [];
  let text: string;
  if (encoding === 'utf8-bom') {
    if (buffer.length < 3 || buffer[0] !== 0xef || buffer[1] !== 0xbb || buffer[2] !== 0xbf) {
      errors.push('Missing UTF-8 BOM (EF BB BF).');
    }
    text = buffer.subarray(3).toString('utf8');
  } else {
    text = buffer.toString('latin1');
  }

  const lines = text.split('\r\n').filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { valid: false, errors: [...errors, 'Missing EXTF header or column header.'], category: 0, dataRowCount: 0 };
  }

  const headerParts = lines[0].split(';');
  if (headerParts[0] !== '"EXTF"' || headerParts[1] !== '700') {
    errors.push(`Invalid EXTF header signature: ${headerParts.slice(0, 2).join(';')}`);
  }
  const category = Number(headerParts[2]);
  const formatVersion = Number(headerParts[4]);
  const expectedCat = Object.values(DATEV_CATEGORIES).find((c) => c.code === category);
  if (!expectedCat) {
    errors.push(`Unknown DATEV category: ${category}`);
  } else if (formatVersion < expectedCat.minFormatVersion) {
    errors.push(`Format version ${formatVersion} below minimum ${expectedCat.minFormatVersion} for category ${category}`);
  }

  if (!/^\d{8}$/.test(headerParts[12] ?? '')) {
    errors.push(`Invalid fiscal year start (WJ-Beginn): ${headerParts[12]}`);
  }

  const dataRows = lines.slice(2);
  if (dataRows.length > DATEV_MAX_ROWS_PER_FILE) {
    errors.push(`Row count ${dataRows.length} exceeds DATEV limit of ${DATEV_MAX_ROWS_PER_FILE}.`);
  }

  if (category === DATEV_CATEGORIES.BUCHUNGSSTAPEL.code) {
    for (let i = 0; i < dataRows.length; i += 1) {
      const cols = dataRows[i].split(';');
      const amount = cols[0];
      if (amount === '0,00' || amount === '0') {
        errors.push(`Row ${i + 1}: 0,00 amount is forbidden.`);
        break;
      }
      const belegdatum = cols[9];
      if (!/^\d{4}$/.test(belegdatum)) {
        errors.push(`Row ${i + 1}: invalid Belegdatum TTMM "${belegdatum}".`);
        break;
      }
      const belegfeld1 = (cols[10] ?? '').replace(/^"|"$/g, '');
      if (!BELEGFELD1_REGEX.test(belegfeld1)) {
        errors.push(`Row ${i + 1}: Belegfeld 1 "${belegfeld1}" violates DATEV regex.`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    category,
    dataRowCount: dataRows.length,
  };
}
