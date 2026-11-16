import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { minorToDecimal } from '../../accounting/money';
import { PostingRole } from '../../posting_rules/constants/posting-roles';
import {
  buildProposal,
  RoleAccounts,
  VoucherProposal,
} from '../../posting_rules/domain/posting-engine';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { CountryPack, PaymentRailConfig } from '../country-pack.types';
import { CountryPackRegistry } from '../country-pack.registry';
import {
  CreateRailSettlementDto,
  RailSettlementAmounts,
  RailSettlementPreview,
} from './payment-rail.types';

/**
 * Resolves a payment rail from a country pack by rail id or payment method.
 * Case-insensitive match against `rail.id` and `rail.methods`.
 */
export function resolveRailConfig(pack: CountryPack, railOrMethod: string): PaymentRailConfig {
  const query = (railOrMethod ?? '').trim().toUpperCase();
  if (!query) {
    throw new BadRequestException('شناسه یا روش پرداخت مشخص نشده است.');
  }

  const rails = pack.paymentRails ?? [];
  const matched = rails.find(
    (r) => r.id.toUpperCase() === query || r.methods.some((m) => m.toUpperCase() === query),
  );

  if (!matched) {
    throw new BadRequestException(
      `روش یا پایانه پرداخت «${railOrMethod}» در بسته کشوری ${pack.name} (${pack.country}) پیکربندی نشده است.`,
    );
  }
  return matched;
}

/**
 * Validates settlement amounts and enforces the fundamental double-entry equation:
 *   gross = net + fee + commission + sst
 *
 * Money amounts must be integer minor units (bigint).
 */
export function validateSettlementAmounts(dto: CreateRailSettlementDto): RailSettlementAmounts {
  const gross = dto.grossAmount;
  const net = dto.netAmount;
  const fee = dto.feeAmount ?? 0n;
  const commission = dto.commissionAmount ?? 0n;
  const sst = dto.sstAmount ?? 0n;

  if (typeof gross !== 'bigint' || gross <= 0n) {
    throw new BadRequestException('مبلغ ناخالص تسویه باید بزرگ‌تر از صفر باشد.');
  }
  if (typeof net !== 'bigint' || net <= 0n) {
    throw new BadRequestException('مبلغ واریزی خالص به بانک باید بزرگ‌تر از صفر باشد.');
  }
  if (fee < 0n) {
    throw new BadRequestException('کارمزد درگاه پرداخت نمی‌تواند منفی باشد.');
  }
  if (commission < 0n) {
    throw new BadRequestException('کمیسیون پلتفرم یا بازارگاه نمی‌تواند منفی باشد.');
  }
  if (sst < 0n) {
    throw new BadRequestException('مالیات بر خدمات (SST) کارمزد نمی‌تواند منفی باشد.');
  }

  const debitSum = net + fee + commission + sst;
  if (debitSum !== gross) {
    throw new BadRequestException(
      `سند تسویه تراز نیست: جمع واریزی خالص (${minorToDecimal(net)}) + کارمزد (${minorToDecimal(fee)}) + کمیسیون (${minorToDecimal(commission)}) + مالیات (${minorToDecimal(sst)}) برابر ${minorToDecimal(debitSum)} است اما مبلغ ناخالص ${minorToDecimal(gross)} می‌باشد.`,
    );
  }

  return { gross, fee, commission, sst, net };
}

/**
 * Builds the voucher proposal for a payment rail settlement (pure, no I/O).
 *
 * Debits:
 *   - bank: net proceeds
 *   - payment_fee: transaction / MDR fees (if > 0n)
 *   - platform_commission: marketplace commissions (if > 0n)
 *   - vat_input: SST on fees & commissions (if > 0n)
 * Credits:
 *   - clearing_rail: gross amount cleared from rail clearing account
 */
export function buildRailSettlementProposal(
  pack: CountryPack,
  dto: CreateRailSettlementDto,
  tenantMapping: RoleAccounts = {},
): VoucherProposal {
  const rail = resolveRailConfig(pack, dto.rail);
  const amounts = validateSettlementAmounts(dto);

  const bankCode = (dto.bankAccountCode ?? '').trim();
  if (!bankCode) {
    throw new BadRequestException('کد حساب معین یا تفصیلی بانک مقصد الزامی است.');
  }

  // Account overrides: bank from DTO, clearing from rail config / DTO override
  const overrides: Partial<Record<PostingRole, string>> = {
    bank: bankCode,
    clearing_rail: dto.overrides?.clearing_rail ?? rail.defaultAccountCode,
    ...(dto.overrides ?? {}),
  };

  return buildProposal({
    docType: 'treasury.rail_settlement',
    amounts: {
      gross: amounts.gross,
      fee: amounts.fee,
      commission: amounts.commission,
      sst: amounts.sst,
      net: amounts.net,
    },
    mapping: tenantMapping,
    overrides,
  });
}

/**
 * Payment Rail Settlement Service (T156 / R9):
 * Coordinates payment rail settlement vouchers across Card/POS, DuitNow QR, eWallets,
 * and marketplace payout reports (Shopee, TikTok Shop, GrabFood).
 */
@Injectable()
export class RailSettlementService {
  private readonly logger = new Logger(RailSettlementService.name);

  constructor(
    private readonly packRegistry: CountryPackRegistry,
    @Optional() private readonly postingRules?: PostingRulesService,
  ) {}

  /**
   * Generates a preview / dry-run proposal of the settlement voucher without persisting anything.
   */
  previewSettlement(country: string, dto: CreateRailSettlementDto, tenantMapping: RoleAccounts = {}): RailSettlementPreview {
    const pack = this.packRegistry.resolve(country);
    const rail = resolveRailConfig(pack, dto.rail);
    const amounts = validateSettlementAmounts(dto);
    const proposal = buildRailSettlementProposal(pack, dto, tenantMapping);
    return { rail, amounts, proposal };
  }

  /**
   * Persists a settlement voucher for the payment rail through the posting rules engine.
   */
  async settleRail(
    tenantId: string,
    country: string,
    dto: CreateRailSettlementDto,
    manager?: EntityManager,
  ): Promise<{ voucherId: string; proposal: VoucherProposal; amounts: RailSettlementAmounts }> {
    if (!this.postingRules) {
      throw new Error('PostingRulesService is not registered in RailSettlementService context.');
    }

    const pack = this.packRegistry.resolve(country);
    const rail = resolveRailConfig(pack, dto.rail);
    const amounts = validateSettlementAmounts(dto);
    const bankCode = (dto.bankAccountCode ?? '').trim();
    if (!bankCode) {
      throw new BadRequestException('کد حساب معین یا تفصیلی بانک مقصد الزامی است.');
    }

    const desc =
      dto.description?.trim() ||
      `تسویه درگاه ${rail.name}${dto.reference ? ` - شناسه تسویه ${dto.reference}` : ''}`;

    const overrides: Partial<Record<PostingRole, string>> = {
      bank: bankCode,
      clearing_rail: dto.overrides?.clearing_rail ?? rail.defaultAccountCode,
      ...(dto.overrides ?? {}),
    };

    const sourceId = dto.idempotencyKey?.trim() || dto.reference?.trim() || `settle:${rail.id}:${dto.date}`;

    const voucher = await this.postingRules.post(
      tenantId,
      {
        docType: 'treasury.rail_settlement',
        sourceType: 'rail_settlement',
        sourceId,
        date: dto.date,
        amounts: {
          gross: amounts.gross,
          fee: amounts.fee,
          commission: amounts.commission,
          sst: amounts.sst,
          net: amounts.net,
        },
        description: desc,
        overrides,
      },
      manager,
    );

    const proposal = buildRailSettlementProposal(pack, dto);

    return {
      voucherId: String(voucher.entryId),
      proposal,
      amounts,
    };
  }
}
