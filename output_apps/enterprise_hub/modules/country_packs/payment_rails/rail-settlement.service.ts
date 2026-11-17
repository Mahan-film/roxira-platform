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
 * Resolves account codes for clearing_rail, payment_fee, platform_commission, and vat_input
 * by reading rail.feeRole / rail.commissionRole / rail.taxRole and checking overrides,
 * tenantMapping, and the pack's own chart of accounts (never silently falling back to IR
 * chart codes for non-IR packs when non-zero amounts are posted).
 */
export function resolveSettlementOverrides(
  pack: CountryPack,
  rail: PaymentRailConfig,
  dto: CreateRailSettlementDto,
  tenantMapping: RoleAccounts = {},
  amounts?: RailSettlementAmounts,
): Partial<Record<PostingRole, string>> {
  const feeRole: PostingRole = rail.feeRole ?? 'payment_fee';
  const commissionRole: PostingRole = rail.commissionRole ?? 'platform_commission';
  const taxRole: PostingRole = rail.taxRole ?? 'vat_input';

  const chartCodes = new Set(
    (pack.chartTemplates ?? []).flatMap((t) => t.accounts.map((a) => a.code)),
  );
  const pickChartCode = (...candidates: string[]): string | undefined =>
    candidates.find((c) => chartCodes.has(c));

  const resolveRoleCode = (
    configuredRole: PostingRole,
    templateRole: PostingRole,
    chartCandidates: string[],
    required: boolean,
    label: string,
  ): string | undefined => {
    const fromOverride = dto.overrides?.[templateRole] ?? dto.overrides?.[configuredRole];
    if (fromOverride) return fromOverride;
    const fromTenant = tenantMapping[templateRole] ?? tenantMapping[configuredRole];
    if (fromTenant) return fromTenant;
    const fromChart = pickChartCode(...chartCandidates);
    if (fromChart) return fromChart;
    if (pack.country !== 'IR' && required) {
      throw new BadRequestException(
        `حساب پیش‌فرض برای «${label}» (نقش ${configuredRole}) در بسته ${pack.country} یافت نشد؛ کد حساب را در overrides مشخص کنید.`,
      );
    }
    return undefined;
  };

  const feeCode = resolveRoleCode(
    feeRole,
    'payment_fee',
    ['62510', '62500'],
    (amounts?.fee ?? 0n) > 0n,
    'کارمزد درگاه',
  );
  const commissionCode = resolveRoleCode(
    commissionRole,
    'platform_commission',
    ['62520'],
    (amounts?.commission ?? 0n) > 0n,
    'کمیسیون پلتفرم',
  );
  const taxCode = resolveRoleCode(
    taxRole,
    'vat_input',
    ['12300'],
    (amounts?.sst ?? 0n) > 0n,
    'مالیات کارمزد',
  );

  const overrides: Partial<Record<PostingRole, string>> = {
    bank: (dto.bankAccountCode ?? '').trim(),
    clearing_rail:
      dto.overrides?.clearing_rail ??
      dto.overrides?.[rail.clearingRole] ??
      tenantMapping[rail.clearingRole] ??
      rail.defaultAccountCode,
    ...(dto.overrides ?? {}),
  };
  if (feeCode) overrides.payment_fee = feeCode;
  if (commissionCode) overrides.platform_commission = commissionCode;
  if (taxCode) overrides.vat_input = taxCode;

  return overrides;
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

  const overrides = resolveSettlementOverrides(pack, rail, dto, tenantMapping, amounts);

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

    const sourceId = dto.idempotencyKey?.trim() || dto.reference?.trim();
    if (!sourceId) {
      throw new BadRequestException('برای ثبت تسویه درگاه، شناسه یکتا (idempotencyKey) یا شماره مرجع تسویه (reference) الزامی است.');
    }

    const overrides = resolveSettlementOverrides(pack, rail, dto, {}, amounts);

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
