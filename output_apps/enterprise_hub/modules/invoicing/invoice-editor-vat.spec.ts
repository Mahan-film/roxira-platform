import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { TenantMeResponseDto } from '../tenants/dto/tenant-me-response.dto';
import { UpdateTenantSettingsDto } from '../tenants/dto/update-tenant-settings.dto';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { InvoicingService } from './services/invoicing.service';
import { VatRateResolver } from './services/vat-rate.resolver';

describe('#477 VAT invoice editor and tenants.default_vat_rate removal', () => {
  describe('Tenants API schema changes', () => {
    it('TenantMeResponseDto does not expose defaultVatRate', () => {
      const tenant = {
        id: 't-1',
        name: 'Acme',
        slug: 'acme',
        countryCode: 'IR',
        packVersion: '1.0.0',
        bookCurrencyCode: 'IRR',
        defaultCalendar: 'jalali',
        timezone: 'Asia/Tehran',
        locale: 'fa-IR',
        fiscalYearStartMonth: 1,
        defaultVatRate: 0.1, // database column exists but is inert
      } as TenantEntity;

      const dto = TenantMeResponseDto.fromEntity(tenant, TenantRole.OWNER);
      expect((dto as unknown as Record<string, unknown>).defaultVatRate).toBeUndefined();
      expect(dto.name).toBe('Acme');
    });

    it('UpdateTenantSettingsDto strips or ignores defaultVatRate via ValidationPipe', async () => {
      const pipe = new ValidationPipe({ whitelist: true, transform: true });
      const transformed = await pipe.transform(
        { defaultVatRate: 0.15, defaultCalendar: 'jalali' },
        { type: 'body', metatype: UpdateTenantSettingsDto },
      );
      expect((transformed as Record<string, unknown>).defaultVatRate).toBeUndefined();
      expect(transformed.defaultCalendar).toBe('jalali');
    });
  });

  describe('Invoicing VAT resolution when editor leaves vatRate empty (undefined)', () => {
    it('resolves statutory rate by invoice date when item.vatRate is undefined', async () => {
      const mockResolver = {
        generalRate: jest.fn().mockResolvedValue({ rate: 0.1, date: '2026-10-15' }),
      } as unknown as VatRateResolver;

      const service = Object.create(InvoicingService.prototype);
      service.vatRates = mockResolver;
      service.isIranianCurrency = jest.fn().mockReturnValue(true);
      service.roundRate = (r: number) => r;
      service.resolveDefaultVatRate = async (tId: string, d: Date) => {
        const { rate } = await mockResolver.generalRate(tId, '2026-10-15');
        return rate;
      };

      const resolved = await service.defaultVatRateForJurisdiction(
        't-1',
        'IR',
        new Date('2026-10-15'),
        [{ description: 'Item 1', quantity: 1, unitPrice: 100 }], // vatRate undefined
      );

      expect(resolved).toBe(0.1);
      expect(mockResolver.generalRate).toHaveBeenCalled();
    });

    it('skips statutory store when all items carry explicit user overrides', async () => {
      const mockResolver = {
        generalRate: jest.fn(),
      } as unknown as VatRateResolver;

      const service = Object.create(InvoicingService.prototype);
      service.vatRates = mockResolver;

      const resolved = await service.defaultVatRateForJurisdiction(
        't-1',
        'IR',
        new Date('2026-10-15'),
        [{ description: 'Item 1', quantity: 1, unitPrice: 100, vatRate: 0.05 }],
      );

      expect(resolved).toBeNull();
      expect(mockResolver.generalRate).not.toHaveBeenCalled();
    });
  });
});
