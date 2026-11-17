import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertValidEInvoicingRegistration, LegalEntitiesService } from './services/legal-entities.service';

const T1 = '11111111-1111-4111-8111-111111111111';

describe('LegalEntitiesService (T224)', () => {
  it('refuses UAE VAT group TIN on upsert and on e-invoicing resolution', async () => {
    const repo: any = {
      list: jest.fn(async () => []),
      findDefault: jest.fn(async () => ({
        id: 'le-1',
        tenantId: T1,
        code: 'AE-MEM-1',
        countryCode: 'AE',
        taxId: '1001234567',
        vatId: '100123456700003',
        einvoiceId: '1001234567',
        vatGroupTin: '1009999999',
      })),
      findById: jest.fn(async () => null),
      upsert: jest.fn(async (_t: string, input: any) => ({ id: 'le-1', ...input })),
    };
    const service = new LegalEntitiesService(repo);

    await expect(
      service.upsert(T1, {
        code: 'AE-MEM-1',
        name: 'Member LLC',
        countryCode: 'AE',
        taxId: '1009999999',
        einvoiceId: '1009999999',
        vatGroupTin: '1009999999',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Passing the group TIN explicitly at e-invoicing time is also refused.
    await expect(service.resolveForEInvoicing(T1, undefined, '1009999999')).rejects.toThrow(
      /UAE VAT group TIN cannot be used for e-invoicing/,
    );

    // Member's own TIN succeeds.
    const ok = await service.resolveForEInvoicing(T1);
    expect(ok).toEqual({
      legalEntityId: 'le-1',
      countryCode: 'AE',
      taxId: '1001234567',
      vatId: '100123456700003',
      einvoiceId: '1001234567',
    });
  });

  it('requires member own TIN for UAE and throws NotFound when entity is missing', async () => {
    expect(() =>
      assertValidEInvoicingRegistration({
        id: 'le-2',
        countryCode: 'AE',
        taxId: null,
        vatId: null,
        einvoiceId: null,
        vatGroupTin: '1009999999',
      }),
    ).toThrow(BadRequestException);

    const repo: any = { findById: jest.fn(async () => null), findDefault: jest.fn(async () => null) };
    const service = new LegalEntitiesService(repo);
    await expect(service.resolveForEInvoicing(T1, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows non-UAE legal entities with vatId or taxId', () => {
    const res = assertValidEInvoicingRegistration({
      id: 'le-de',
      countryCode: 'DE',
      taxId: null,
      vatId: 'DE123456789',
      einvoiceId: 'DE123456789',
      vatGroupTin: null,
    });
    expect(res).toEqual({
      legalEntityId: 'le-de',
      countryCode: 'DE',
      taxId: 'DE123456789',
      vatId: 'DE123456789',
      einvoiceId: 'DE123456789',
    });
  });
});
