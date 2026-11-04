import { MoadianInvoicePattern, MoadianInvoiceSubject, MoadianInvoiceType, MoadianBuyerType } from '../enums/moadian.enum';
import { BODY_RULES, HEADER_RULES, isType2Pattern, statusOf } from './moadian-pattern-rules';

type Bag = Record<string, unknown>;

export class MoadianPacketValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Moadian packet is not valid for its type and pattern: ${problems.join('; ')}`);
  }
}

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const num = (v: unknown): number => Number(v);

/**
 * Format rules (type, length, range) of the fields the mapper can send, from the Tir 1405 columns
 * "Data Type", "Length" and "Validation Rule" of docs/legal_sources/iran/moadian-fields.md.
 * `unclear` in that file (not enforced here): scln conditions, rid, pv bounds, extension[], envelope
 * field types, the 5th buyer type, rounding of `cfee * exr`, `ssrv = sscv * exr` and the VAT formulas.
 */
const digits = (min: number, max = min) => (v: unknown) => typeof v === 'string' && new RegExp(`^\\d{${min},${max}}$`).test(v);
const text = (max: number) => (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (maxDigits: number) => (v: unknown) => Number.isInteger(v) && Math.abs(num(v)).toString().length <= maxDigits;
const decimal = (maxInt: number, maxFrac: number) => (v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const [whole, frac = ''] = Math.abs(v).toFixed(Math.max(maxFrac, 8)).replace(/0+$/, '').split('.');
  return whole.length <= maxInt && frac.length <= maxFrac;
};
const oneOf = (...values: number[]) => (v: unknown) => values.includes(num(v));
const percent = (v: unknown) => decimal(3, 2)(v) && num(v) >= 0 && num(v) <= 100;

const HEADER_FORMAT: Record<string, (v: unknown) => boolean> = {
  taxid: text(22), irtaxid: text(22), indatim: integer(13), indati2m: integer(13), insr: oneOf(1, 2),
  inno: (v) => typeof v === 'string' && /^[0-9A-F]{10}$/.test(v), tins: (v) => digits(11)(v) || digits(14)(v),
  tob: oneOf(1, 2, 3, 4, 5), bid: digits(10, 12), tinb: (v) => digits(11)(v) || digits(14)(v), sbc: digits(4),
  bpc: digits(10), bbc: digits(4), ft: oneOf(1, 2), bpn: (v) => typeof v === 'string' && /^[0-9A-Za-z]{9}$/.test(v),
  scln: digits(1, 14), scc: digits(5), cdcn: text(14), cdcd: integer(5), crn: digits(1, 12), billid: digits(1, 19),
  tprdis: integer(18), tdis: integer(18), tadis: integer(18), tvam: integer(18), todam: integer(18),
  tbill: integer(18), tonw: decimal(16, 8), torv: integer(18), tocv: decimal(14, 4), setm: oneOf(1, 2, 3),
  cap: integer(18), insp: integer(18), tvop: integer(18), tax17: integer(18), tinc: (v) => digits(11)(v) || digits(14)(v),
  nti1: text(30), nti2: text(30),
};

const BODY_FORMAT: Record<string, (v: unknown) => boolean> = {
  sstid: digits(13), sstt: text(400), am: decimal(18, 8), mu: text(8), nw: decimal(16, 8), fee: decimal(18, 8),
  cfee: decimal(14, 4), cut: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v), exr: decimal(18, 8),
  ssrv: integer(18), sscv: decimal(14, 4), prdis: integer(18), dis: integer(18), adis: integer(18),
  vra: percent, vam: integer(18), odt: text(255), odr: percent, odam: integer(18), olt: text(255), olr: percent,
  olam: integer(18), consfee: integer(18), spro: integer(18), bros: integer(18), tcpbs: integer(18),
  cop: integer(18), vop: integer(18), bsrn: digits(1, 12), tsstam: integer(18), cui: decimal(4, 2),
  cpr: decimal(18, 8), sovat: integer(18),
};

const sum = (rows: Bag[], key: string): number => rows.reduce((a, r) => a + num(r[key] ?? 0), 0);
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

export function validatePacketAgainstPattern(header: Bag, body: Bag[]): void {
  const problems: string[] = [];
  const type = header.inty as MoadianInvoiceType;
  const pattern = header.inp as MoadianInvoicePattern;
  const ins = header.ins as MoadianInvoiceSubject;

  if (type === MoadianInvoiceType.RETAIL) {
    throw new MoadianPacketValidationError(['type 3 (retail/POS) has no field table in the source: unclear']);
  }
  if (type !== MoadianInvoiceType.WITH_BUYER && type !== MoadianInvoiceType.WITHOUT_BUYER) {
    throw new MoadianPacketValidationError([`inty ${String(type)} is not 1 or 2`]);
  }
  if (!Number.isInteger(pattern) || pattern < 1 || pattern > 7) {
    throw new MoadianPacketValidationError([`pattern ${String(pattern)} is outside the supported patterns 1 to 7`]);
  }
  if (type === MoadianInvoiceType.WITHOUT_BUYER && !isType2Pattern(pattern)) {
    problems.push(`type 2 is allowed only for patterns 1 and 3, not ${pattern}`);
  }
  if (pattern === MoadianInvoicePattern.EXPORT && ins === MoadianInvoiceSubject.CORRECTIVE) {
    problems.push('ins 2 (corrective) is not allowed in pattern 7 (export)');
  }

  const checkBag = (
    bag: Bag,
    rules: typeof HEADER_RULES,
    format: typeof HEADER_FORMAT,
    where: string,
    conditional: (field: string) => boolean | null,
  ): void => {
    for (const field of Object.keys(rules)) {
      const status = statusOf(rules, field, type, pattern);
      const has = present(bag[field]);
      if (status === 'M' && !has) problems.push(`${where}${field} is mandatory`);
      if (status === 'I' && has) problems.push(`${where}${field} is out of pattern and must not be sent`);
      if (status === 'C') {
        const required = conditional(field);
        if (required === true && !has) problems.push(`${where}${field} is required here`);
        if (required === false && has) problems.push(`${where}${field} must not be sent here`);
      }
      if (has && format[field] && !format[field](bag[field])) problems.push(`${where}${field} has an invalid format or length`);
    }
  };

  const setm = num(header.setm);
  const late = num(header.insr) === 1;
  checkBag(header, HEADER_RULES, HEADER_FORMAT, 'header.', (field) => {
    switch (field) {
      case 'indati2m':
      case 'insr':
        return late;
      case 'irtaxid':
        return ins !== MoadianInvoiceSubject.MAIN;
      case 'bid':
      case 'bpn':
        return header.tob === MoadianBuyerType.FOREIGN_NATIONAL && !present(header.bid) && !present(header.bpn) ? true : null;
      case 'cap':
      case 'insp':
        return setm === 3;
      case 'tonw':
        return body.some((r) => present(r.nw));
      case 'tinb':
        return null;
      default:
        return null;
    }
  });
  body.forEach((row, i) =>
    checkBag(row, BODY_RULES, BODY_FORMAT, `body[${i}].`, (field) => {
      if (field === 'nw') return null;
      // other taxes and other funds: all three of a group or none
      const group = field.startsWith('od') ? ['odt', 'odr', 'odam'] : ['olt', 'olr', 'olam'];
      return group.some((g) => present(row[g])) ? true : false;
    }),
  );

  if (header.tob !== undefined && present(header.bid) && present(header.tob)) {
    const need: Record<number, number> = { 1: 10, 2: 11, 3: 12, 4: 12 };
    const len = String(header.bid).length;
    if (need[num(header.tob)] && len !== need[num(header.tob)]) problems.push(`header.bid length ${len} does not match buyer type ${String(header.tob)}`);
  }
  if (late && present(header.indati2m) && !(num(header.indati2m) > num(header.indatim))) {
    problems.push('header.indati2m must be later than indatim');
  }
  if (setm === 3 && present(header.cap) && present(header.insp)) {
    if (!(num(header.insp) > 0)) problems.push('header.insp must be greater than 0 when setm is 3');
    if (num(header.cap) + num(header.insp) > num(header.tbill)) problems.push('header.cap + insp must not exceed tbill');
  }

  // Totals are the sums of the lines (Tir 1405 totals rules).
  for (const [total, line] of [['tprdis', 'prdis'], ['tdis', 'dis'], ['tadis', 'adis'], ['tvam', 'vam'], ['tbill', 'tsstam'], ['torv', 'ssrv'], ['tocv', 'sscv'], ['tonw', 'nw']] as const) {
    if (present(header[total]) && !near(num(header[total]), sum(body, line))) problems.push(`header.${total} is not the sum of body ${line}`);
  }
  if (present(header.todam) && !near(num(header.todam), sum(body, 'odam') + sum(body, 'olam'))) {
    problems.push('header.todam is not the sum of body odam and olam');
  }
  if (pattern === MoadianInvoicePattern.EXPORT) {
    body.forEach((r, i) => num(r.vra) !== 0 && problems.push(`body[${i}].vra must be 0 in pattern 7`));
    if (!(num(header.torv) > 0) || !(num(header.tocv) > 0)) problems.push('header.torv and tocv must be greater than 0');
  }
  if (pattern === MoadianInvoicePattern.GOLD) {
    body.forEach((r, i) => {
      if (num(r.tcpbs) !== num(r.consfee) + num(r.spro) + num(r.bros)) problems.push(`body[${i}].tcpbs must be consfee + spro + bros`);
      if (present(r.cui) && !(num(r.cui) > 0 && num(r.cui) <= 1000)) problems.push(`body[${i}].cui must be in (0, 1000]`);
    });
  }
  if (pattern === MoadianInvoicePattern.SALE_CURRENCY) {
    body.forEach((r, i) => {
      if (present(r.cpr) && present(r.exr) && !(num(r.cpr) > 0 && num(r.cpr) < num(r.exr))) problems.push(`body[${i}].cpr must satisfy 0 < cpr < exr`);
    });
  }
  // Foreign-currency group: if any of cfee, cut, exr is sent, all three are (pattern 7 sends cut and exr only).
  if (pattern !== MoadianInvoicePattern.EXPORT) body.forEach((r, i) => {
    const group = ['cfee', 'cut', 'exr'].filter((k) => present(r[k]));
    if (group.length > 0 && group.length < 3) problems.push(`body[${i}] cfee, cut and exr must be sent together`);
  });

  if (problems.length > 0) throw new MoadianPacketValidationError(problems);
}
