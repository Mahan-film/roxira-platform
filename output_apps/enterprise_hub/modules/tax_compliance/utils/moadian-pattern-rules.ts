import { MoadianInvoicePattern, MoadianInvoiceType } from '../enums/moadian.enum';

/**
 * Field requirement by invoice type and pattern for patterns 1 to 7, copied from
 * docs/legal_sources/iran/moadian-fields.md (Tir 1405 Table 1 and Section 8), column
 * "Required by Invoice Type & Template". Statuses: M mandatory, O optional, C conditionally
 * mandatory (the rule is in `validatePacketAgainstPattern`), I ignore (out of pattern: never sent).
 *
 * Each row is `[type 1 for patterns 1..7, type 2 for patterns 1 and 3]`. Type 2 exists only for
 * patterns 1 and 3 among these seven. Type 3 (retail/POS receipt) has no per-field table in the source
 * (Section 3-3 lists its content only), so it is `unclear` and rejected by the mapper.
 */
export type FieldStatus = 'M' | 'O' | 'C' | 'I';
type Row = readonly [string, string];

const ALL_M: Row = ['MMMMMMM', 'MM'];
const ALL_O: Row = ['OOOOOOO', 'OO'];
const ALL_C: Row = ['CCCCCCC', 'CC'];
const ALL_I: Row = ['IIIIIII', 'II'];

export const HEADER_RULES: Record<string, Row> = {
  taxid: ALL_M, indatim: ALL_M, inty: ALL_M, inp: ALL_M, ins: ALL_M, tins: ALL_M, tvam: ALL_M, tbill: ALL_M,
  todam: ALL_M, indati2m: ALL_C, irtaxid: ALL_C, insr: ALL_C, inno: ALL_O, sbc: ALL_O, bpc: ALL_O, bbc: ALL_O,
  nti1: ALL_O, nti2: ALL_O,
  tob: ['MMMMMMO', 'OO'],
  bid: ['OCOOOCO', 'OO'],
  tinb: ['CCCCOOO', 'OO'],
  ft: ['IIIIIMI', 'II'],
  bpn: ['ICIIICO', 'II'],
  scln: ['OOIIIII', 'II'],
  scc: ['OOIIIIO', 'II'],
  cdcn: ['IIIIIIO', 'II'],
  cdcd: ['IIIIIIO', 'II'],
  crn: ['OOOMIII', 'II'],
  billid: ['IIIIMII', 'II'],
  tprdis: ['MMMMMMI', 'MM'],
  tdis: ['OOOOOOI', 'OO'],
  tadis: ['MMMMMMI', 'MM'],
  tonw: ['IIIIIIC', 'II'],
  torv: ['IIIIIIM', 'II'],
  tocv: ['IIIIIIM', 'II'],
  setm: ['MMMMMMM', 'II'],
  cap: ['CCCCCCC', 'II'],
  insp: ['CCCCCCC', 'II'],
  tvop: ['OOOOOOO', 'II'],
  tax17: ['OOOOOOI', 'OO'],
  tinc: ['IIIIIOI', 'II'],
};

export const BODY_RULES: Record<string, Row> = {
  sstid: ALL_M, vra: ALL_M, vam: ALL_M, tsstam: ALL_M, sstt: ALL_O, bsrn: ALL_O,
  odt: ALL_C, odr: ALL_C, odam: ALL_C, olt: ALL_C, olr: ALL_C, olam: ALL_C,
  am: ['MIMMMMM', 'MM'],
  mu: ['OIOOOOO', 'OO'],
  nw: ['IIIIIIC', 'II'],
  fee: ['MIMMMMO', 'MM'],
  cfee: ['OMOOIOI', 'OO'],
  cut: ['OMOOIOM', 'OO'],
  exr: ['OMOOIOM', 'OO'],
  ssrv: ['IIIIIIM', 'II'],
  sscv: ['IIIIIIM', 'II'],
  prdis: ['MMMMMMI', 'MM'],
  dis: ['MMMMMMI', 'MM'],
  adis: ['MMMMMMI', 'MM'],
  consfee: ['IIMIIII', 'IM'],
  spro: ['IIMIIII', 'IM'],
  bros: ['IIMIIII', 'IM'],
  tcpbs: ['IIMIIII', 'IM'],
  cop: ['OOOOOOO', 'II'],
  vop: ['OOOOOOO', 'II'],
  cui: ['IIOIIII', 'IO'],
  cpr: ['IMIIIII', 'II'],
  sovat: ['IMIIIII', 'II'],
};

/** Patterns 1 to 7 are the only ones with rules here; type 2 is allowed for patterns 1 and 3 only. */
export function statusOf(
  rules: Record<string, Row>,
  field: string,
  type: MoadianInvoiceType,
  pattern: MoadianInvoicePattern,
): FieldStatus {
  const row = rules[field];
  if (!row) return 'I';
  if (type === MoadianInvoiceType.WITH_BUYER) return row[0][pattern - 1] as FieldStatus;
  const index = pattern === MoadianInvoicePattern.SALE ? 0 : pattern === MoadianInvoicePattern.GOLD ? 1 : -1;
  return index < 0 ? 'I' : (row[1][index] as FieldStatus);
}

export const isType2Pattern = (pattern: MoadianInvoicePattern): boolean =>
  pattern === MoadianInvoicePattern.SALE || pattern === MoadianInvoicePattern.GOLD;
