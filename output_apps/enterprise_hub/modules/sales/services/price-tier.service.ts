import { Injectable } from '@nestjs/common';
import { toMinor, fromMinor } from '../../accounting/money';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';
import { PriceTierEntity } from '../entities/price-tier.entity';
import { PriceTiersRepository } from '../repositories/price-tiers.repository';
import { CreatePriceTierDto } from '../dto/price-tier.dto';

export interface PriceResolution {
  unitPriceMinor: bigint;
  discountPercent: number;
  discountAmountMinor: bigint;
  effectiveUnitPriceMinor: bigint;
  source: 'tier' | 'base_default';
  customerGroup: CustomerGroup;
}

/** Returns current date in Tehran timezone formatted as YYYY-MM-DD */
export function getCurrentTehranDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
}

@Injectable()
export class PriceTierService {
  constructor(private readonly priceTiersRepo: PriceTiersRepository) {}

  /**
   * Resolves the effective unit price for a customer and SKU based on the customer group.
   * If an active price tier exists for (sku, customerGroup), returns that tier's price
   * minus any tier discount.
   * Otherwise falls back to basePriceMinor with standard consumer tier.
   */
  resolvePrice(
    sku: string,
    customerGroup: CustomerGroup | null | undefined,
    basePriceMinor: bigint,
    tierRecords?: PriceTierEntity[] | null,
    referenceDate: string = getCurrentTehranDate(),
  ): PriceResolution {
    const group = customerGroup ?? CustomerGroup.CONSUMER;

    if (tierRecords && tierRecords.length > 0) {
      const match = tierRecords.find((tier) => {
        if (tier.sku !== sku || tier.customerGroup !== group) {
          return false;
        }
        if (tier.effectiveFrom && tier.effectiveFrom > referenceDate) {
          return false;
        }
        if (tier.effectiveTo && tier.effectiveTo < referenceDate) {
          return false;
        }
        return true;
      });

      if (match) {
        const unitPriceMinor = BigInt(match.unitPrice);
        const discountPercent = match.discountPercent ?? 0;
        if (Number.isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          throw new Error(`Invalid discount percent: ${discountPercent}`);
        }
        const discountBps = BigInt(Math.round(discountPercent * 100));
        // Half-up rounding for integer division: (numerator + 5000n) / 10000n
        const discountAmountMinor = (unitPriceMinor * discountBps + 5000n) / 10000n;
        const effectiveUnitPriceMinor = unitPriceMinor - discountAmountMinor;

        return {
          unitPriceMinor,
          discountPercent,
          discountAmountMinor,
          effectiveUnitPriceMinor,
          source: 'tier',
          customerGroup: group,
        };
      }
    }

    return {
      unitPriceMinor: basePriceMinor,
      discountPercent: 0,
      discountAmountMinor: 0n,
      effectiveUnitPriceMinor: basePriceMinor,
      source: 'base_default',
      customerGroup: group,
    };
  }

  async resolveForTenant(
    tenantId: string,
    sku: string,
    customerGroup: CustomerGroup | null | undefined,
    basePriceMinor: bigint,
    referenceDate: string = getCurrentTehranDate(),
  ): Promise<PriceResolution> {
    const group = customerGroup ?? CustomerGroup.CONSUMER;
    const activeTiers = await this.priceTiersRepo.findActiveTiers(tenantId, sku, group, referenceDate);
    return this.resolvePrice(sku, group, basePriceMinor, activeTiers, referenceDate);
  }

  async createTier(tenantId: string, dto: CreatePriceTierDto): Promise<PriceTierEntity> {
    return this.priceTiersRepo.create(tenantId, {
      sku: dto.sku,
      customerGroup: dto.customerGroup,
      unitPrice: BigInt(dto.unitPriceMinor),
      discountPercent: dto.discountPercent,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo,
    });
  }

  async listTiers(tenantId: string, sku?: string, group?: CustomerGroup): Promise<PriceTierEntity[]> {
    return this.priceTiersRepo.list(tenantId, sku, group);
  }

  async deleteTier(tenantId: string, id: number): Promise<boolean> {
    return this.priceTiersRepo.deleteById(tenantId, id);
  }
}
