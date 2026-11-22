import { InvoiceDirection } from './enums/invoice-kind.enum';
import { InvoicingService } from './services/invoicing.service';

describe('#548 imported sales invoices link customerId from party code', () => {
  it('links an existing non-walk-in CRM lead by party.id when available', async () => {
    const crmRepo = {
      findLeadById: jest.fn().mockResolvedValue({ id: 42, isWalkIn: false }),
      createLead: jest.fn(),
    };
    const service = Object.create(InvoicingService.prototype);
    service.crmRepository = crmRepo;
    service.ownName = jest.fn().mockResolvedValue('Our Co');

    const dto = await service.importedDtoFromPlan('t-1', {
      invoiceNumber: 'INV-S-1403-0001',
      direction: InvoiceDirection.SALE,
      party: { id: 42, code: 'CUST-001', name: 'Customer 1' },
      lines: [{ sku: 'SKU-1', quantity: 1, unitPriceMinor: 10000n, vatRate: 0.1 }],
      currency: null,
      fxRate: null,
    });

    expect(dto.customerId).toBe(42);
    expect(dto.buyerInfo?.name).toBe('Customer 1');
    expect(crmRepo.findLeadById).toHaveBeenCalledWith('t-1', 42);
    expect(crmRepo.createLead).not.toHaveBeenCalled();
  });

  it('creates a non-walk-in IMPORT CRM lead when party has no matching CRM lead yet', async () => {
    const crmRepo = {
      findLeadById: jest.fn().mockResolvedValue(null),
      createLead: jest.fn().mockResolvedValue({ id: 99, isWalkIn: false }),
    };
    const service = Object.create(InvoicingService.prototype);
    service.crmRepository = crmRepo;
    service.ownName = jest.fn().mockResolvedValue('Our Co');

    const dto = await service.importedDtoFromPlan('t-1', {
      invoiceNumber: 'INV-S-1403-0002',
      direction: InvoiceDirection.SALE,
      party: { id: 7, code: 'CUST-002', name: 'Customer 2' },
      lines: [{ sku: 'SKU-1', quantity: 1, unitPriceMinor: 10000n, vatRate: 0.1 }],
      currency: null,
      fxRate: null,
    });

    expect(dto.customerId).toBe(99);
    expect(crmRepo.findLeadById).toHaveBeenCalledWith('t-1', 7);
    expect(crmRepo.createLead).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({
        fullName: 'Customer 2',
        isWalkIn: false,
        source: 'IMPORT',
        pipelineStage: 'WON',
      }),
    );
  });

  it('does not set customerId on PURCHASE invoices', async () => {
    const crmRepo = {
      findLeadById: jest.fn(),
      createLead: jest.fn(),
    };
    const service = Object.create(InvoicingService.prototype);
    service.crmRepository = crmRepo;
    service.ownName = jest.fn().mockResolvedValue('Our Co');

    const dto = await service.importedDtoFromPlan('t-1', {
      invoiceNumber: 'INV-P-1403-0001',
      direction: InvoiceDirection.PURCHASE,
      party: { id: 42, code: 'VEND-001', name: 'Vendor 1' },
      lines: [{ sku: 'SKU-1', quantity: 1, unitPriceMinor: 10000n, vatRate: 0.1 }],
      currency: null,
      fxRate: null,
    });

    expect(dto.customerId).toBeUndefined();
    expect(crmRepo.findLeadById).not.toHaveBeenCalled();
  });
});
