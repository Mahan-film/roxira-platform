import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingService } from './invoicing.service';

describe('InvoicingService.isInvoiceOverdue (Tehran day)', () => {
  it('uses Asia/Tehran calendar day rather than UTC day', () => {
    // 2026-11-25T20:29:59Z is 23:59:59 in Tehran (still 2026-11-25)
    const beforeTehranMidnight = new Date('2026-11-25T20:29:59Z');
    // 2026-11-25T20:30:01Z is 00:00:01 in Tehran (already 2026-11-26)
    const afterTehranMidnight = new Date('2026-11-25T20:30:01Z');

    expect(
      InvoicingService.isInvoiceOverdue(
        InvoiceStatus.ISSUED,
        '2026-11-25',
        beforeTehranMidnight,
      ),
    ).toBe(false);

    expect(
      InvoicingService.isInvoiceOverdue(
        InvoiceStatus.ISSUED,
        '2026-11-25',
        afterTehranMidnight,
      ),
    ).toBe(true);
  });

  it('returns false for non-ISSUED statuses or null dueDate', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(InvoicingService.isInvoiceOverdue(InvoiceStatus.DRAFT, '2026-11-01', now)).toBe(false);
    expect(InvoicingService.isInvoiceOverdue(InvoiceStatus.PAID, '2026-11-01', now)).toBe(false);
    expect(InvoicingService.isInvoiceOverdue(InvoiceStatus.CANCELLED, '2026-11-01', now)).toBe(false);
    expect(InvoicingService.isInvoiceOverdue(InvoiceStatus.ISSUED, null, now)).toBe(false);
  });
});
