import { MoadianInvoiceSubject as S, MoadianSubmissionStatus as St } from '../enums/moadian.enum';
import type { InvoiceItem } from '../../invoicing/entities/invoice.entity';
import { ChainRow, isFullReturn, resolveChainReference, TaxChainBlockedError } from './tax-reference-chain';

const row = (over: Partial<ChainRow>): ChainRow => ({
  invoiceId: 'inv-main',
  ins: S.MAIN,
  status: St.SUCCESS,
  taxId: 'MAINTAXID',
  activeReferenceTaxId: 'MAINTAXID',
  ...over,
});
const line = (quantity: number, originalLine?: number): InvoiceItem =>
  ({ description: 'x', quantity, unitPrice: 1, discount: 0, vatRate: 0.1, tax: 0, total: 0, originalLine }) as InvoiceItem;

describe('resolveChainReference', () => {
  it('uses the main taxid when nothing was amended', () => {
    const root = row({});
    expect(resolveChainReference(root, [root])).toBe('MAINTAXID');
  });

  it('uses the latest confirmed taxid after an amendment advanced the reference', () => {
    const root = row({ activeReferenceTaxId: 'AMEND1' });
    const amend = row({ invoiceId: 'inv-a1', ins: S.CORRECTIVE, taxId: 'AMEND1', activeReferenceTaxId: null });
    expect(resolveChainReference(root, [root, amend])).toBe('AMEND1');
  });

  it('falls back to taxId for legacy rows without an active reference', () => {
    const root = row({ activeReferenceTaxId: null });
    expect(resolveChainReference(root, [root])).toBe('MAINTAXID');
  });

  it.each([St.QUEUED, St.SENT, St.UNKNOWN])('blocks while a chain member is %s', (status) => {
    const root = row({});
    const pending = row({ invoiceId: 'inv-a1', ins: S.CORRECTIVE, taxId: 'A1', status, activeReferenceTaxId: null });
    expect(() => resolveChainReference(root, [root, pending])).toThrow(TaxChainBlockedError);
  });

  it('blocks while the main invoice itself is not confirmed', () => {
    const root = row({ status: St.UNKNOWN });
    expect(() => resolveChainReference(root, [root])).toThrow(/not confirmed/);
    expect(() => resolveChainReference(null, [])).toThrow(TaxChainBlockedError);
  });

  it('a FAILED member does not block and does not move the reference', () => {
    const root = row({});
    const failed = row({ invoiceId: 'inv-a1', ins: S.CORRECTIVE, taxId: 'A1', status: St.FAILED, activeReferenceTaxId: null });
    expect(resolveChainReference(root, [root, failed])).toBe('MAINTAXID');
  });

  it('blocks everything after a confirmed cancellation', () => {
    const root = row({});
    const cancel = row({ invoiceId: 'inv-c', ins: S.CANCELLATION, taxId: 'C1', activeReferenceTaxId: null });
    expect(() => resolveChainReference(root, [root, cancel])).toThrow(/already cancelled/);
  });
});

describe('isFullReturn', () => {
  const original = [line(2), line(1.5)];
  it('is true when every original line is returned in full', () => {
    expect(isFullReturn(original, [line(2, 0), line(1.5, 1)])).toBe(true);
  });
  it('is false for a partial quantity', () => {
    expect(isFullReturn(original, [line(2, 0), line(1, 1)])).toBe(false);
  });
  it('is false when a line is missing or has no originalLine', () => {
    expect(isFullReturn(original, [line(2, 0)])).toBe(false);
    expect(isFullReturn(original, [line(2), line(1.5)])).toBe(false);
  });
  it('is false for an empty original', () => {
    expect(isFullReturn([], [])).toBe(false);
  });
});
