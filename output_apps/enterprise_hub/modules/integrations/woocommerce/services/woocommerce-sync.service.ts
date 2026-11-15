import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as dns from 'dns/promises';
import * as net from 'net';
import { fromDb, minorToDecimal, parseScaled, toMinor } from '../../../accounting/money';
import { BASE_CURRENCY } from '../../../currency/constants/currency.constants';
import { Currency } from '../../../currency/enums/currency.enum';
import { CurrencyService } from '../../../currency/services/currency.service';
import { InvoiceItem, InvoicePartyInfo } from '../../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../../invoicing/enums/invoice-jurisdiction.enum';
import {
  EInvoiceType,
  InvoiceDirection,
  InvoiceSubject,
} from '../../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../../invoicing/repositories/invoicing.repository';
import { TenantsRepository } from '../../../tenants/repositories/tenants.repository';
import {
  UpdateWooCommerceConfigDto,
  WooCommerceConfigResponseDto,
} from '../dto/woocommerce-config.dto';
import { WooCommerceOrderWebhookDto } from '../dto/woocommerce-order.dto';
import { WooCommerceSyncLogQueryDto } from '../dto/woocommerce-sync-log.dto';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncLogEntity,
  WooCommerceSyncStatus,
} from '../entities/woocommerce-sync-log.entity';
import { WooCommerceRepository } from '../repositories/woocommerce.repository';
import {
  PRIVATE_BLOCKLIST,
  assertSafeStoreUrl,
  maskApiKey,
  openSecret,
  sealSecret,
} from '../utils/woocommerce-crypto.util';

const SUPPORTED_ORDER_CURRENCIES = new Set<string>(Object.values(Currency));
const TOMAN_TO_RIAL = 10;
const RATIO_SCALE = 1_000_000;

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const dnsValidationCache = new Map<string, { valid: boolean; expiresAt: number }>();

/**
 * Safely converts minor units (cents) to a number for the Invoicing API.
 * Throws if the amount exceeds safe integer range, preventing silent precision loss.
 */
function minorToNumber(minor: bigint): number {
  const decStr = minorToDecimal(minor);
  const n = Number(decStr);
  if (!Number.isFinite(n)) {
    throw new Error(`Amount ${decStr} cannot be safely converted to number`);
  }
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Amount ${decStr} exceeds Number.MAX_SAFE_INTEGER precision`);
  }
  return n;
}

function parseLineQuantity(raw: unknown): { qty: number; scaledQty: bigint } {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const str = raw.toString();
    try {
      const scaled = parseScaled(str, 4);
      return { qty: raw, scaledQty: scaled };
    } catch {
      const whole = Math.max(1, Math.floor(raw));
      return { qty: whole, scaledQty: BigInt(whole) * 10000n };
    }
  }
  const str = String(raw || '1').trim();
  try {
    const scaled = parseScaled(str, 4);
    const num = Number(str);
    return {
      qty: Number.isFinite(num) && num > 0 ? num : 1,
      scaledQty: scaled > 0n ? scaled : 10000n,
    };
  } catch {
    return { qty: 1, scaledQty: 10000n };
  }
}

function vatRateOf(amountMinor: bigint, vatMinor: bigint): number {
  if (amountMinor <= 0n || vatMinor <= 0n) return 0;
  const RATE_FACTOR = 1_000_000n; // scale 6
  const scaled = (vatMinor * RATE_FACTOR) / amountMinor;
  return Number(scaled) / 1_000_000;
}

function parseWooAmount(val?: string | number | null): bigint {
  if (val === undefined || val === null || val === '') return 0n;
  const str = String(val).trim();
  if (!str) return 0n;
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new BadRequestException(`مبلغ ارزی نامعتبر است: ${str}`);
  }
  try {
    return fromDb(str);
  } catch {
    throw new BadRequestException(`مبلغ ارزی نامعتبر است: ${str}`);
  }
}

function isMaskedSecretInput(value?: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return (
    trimmed.length === 0 ||
    trimmed === '****' ||
    /^(ck_|cs_)?\.\.\.[^\s]{4}$/.test(trimmed)
  );
}

@Injectable()
export class WooCommerceSyncService {
  private readonly logger = new Logger(WooCommerceSyncService.name);

  constructor(
    private readonly wooRepo: WooCommerceRepository,
    private readonly invoicingRepo: InvoicingRepository,
    private readonly currencyService: CurrencyService,
    private readonly tenantsRepo: TenantsRepository,
  ) {}

  async getConfig(tenantId: string): Promise<WooCommerceConfigResponseDto> {
    const config = await this.wooRepo.findConfig(tenantId);
    if (!config) {
      throw new NotFoundException('WooCommerce configuration not found for tenant');
    }
    const openKey = openSecret(config.consumerKeyEncrypted, tenantId);
    const plainWebhookSecret = openSecret(config.webhookSecret, tenantId);

    return {
      storeUrl: config.storeUrl,
      maskedConsumerKey: maskApiKey(openKey),
      hasConsumerSecret: Boolean(config.consumerSecretEncrypted),
      webhookSecret: maskApiKey(plainWebhookSecret),
      webhookUrl: `/api/backend/enterprise-hub/integrations/woocommerce/webhook/${tenantId}`,
      autoSyncOrders: config.autoSyncOrders,
      autoSyncStock: config.autoSyncStock,
      lastSyncAt: config.lastSyncAt,
      updatedAt: config.updatedAt,
    };
  }

  async saveConfig(
    tenantId: string,
    dto: UpdateWooCommerceConfigDto,
  ): Promise<WooCommerceConfigResponseDto> {
    if (!dto.storeUrl?.trim()) {
      throw new BadRequestException('storeUrl is required');
    }
    try {
      assertSafeStoreUrl(dto.storeUrl);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Invalid WooCommerce storeUrl');
    }
    const existing = await this.wooRepo.findConfig(tenantId);

    if (!existing && (!dto.consumerKey?.trim() || !dto.consumerSecret?.trim())) {
      throw new BadRequestException(
        'consumerKey and consumerSecret are required for initial WooCommerce setup',
      );
    }

    const keyEncrypted = dto.consumerKey?.trim()
      ? sealSecret(dto.consumerKey.trim(), tenantId)
      : existing!.consumerKeyEncrypted;

    const secretEncrypted = dto.consumerSecret?.trim()
      ? sealSecret(dto.consumerSecret.trim(), tenantId)
      : existing!.consumerSecretEncrypted;

    let webhookSecretEncrypted: string;
    let generatedWebhookSecret: string | undefined;
    if (!isMaskedSecretInput(dto.webhookSecret)) {
      webhookSecretEncrypted = sealSecret(dto.webhookSecret!.trim(), tenantId);
    } else if (existing?.webhookSecret) {
      webhookSecretEncrypted = existing.webhookSecret;
    } else {
      generatedWebhookSecret = randomBytes(24).toString('hex');
      webhookSecretEncrypted = sealSecret(generatedWebhookSecret, tenantId);
    }

    const saved = await this.wooRepo.saveConfig(tenantId, {
      storeUrl: dto.storeUrl.trim(),
      consumerKeyEncrypted: keyEncrypted,
      consumerSecretEncrypted: secretEncrypted,
      webhookSecret: webhookSecretEncrypted,
      autoSyncOrders:
        dto.autoSyncOrders !== undefined
          ? dto.autoSyncOrders
          : existing?.autoSyncOrders ?? true,
      autoSyncStock:
        dto.autoSyncStock !== undefined
          ? dto.autoSyncStock
          : existing?.autoSyncStock ?? true,
    });

    const plainKey = openSecret(saved.consumerKeyEncrypted, tenantId);
    const plainWebhook = openSecret(saved.webhookSecret, tenantId);

    return {
      storeUrl: saved.storeUrl,
      maskedConsumerKey: maskApiKey(plainKey),
      hasConsumerSecret: Boolean(saved.consumerSecretEncrypted),
      webhookSecret: maskApiKey(plainWebhook),
      webhookUrl: `/api/backend/enterprise-hub/integrations/woocommerce/webhook/${tenantId}`,
      autoSyncOrders: saved.autoSyncOrders,
      autoSyncStock: saved.autoSyncStock,
      lastSyncAt: saved.lastSyncAt,
      updatedAt: saved.updatedAt,
      ...(generatedWebhookSecret ? { generatedWebhookSecret } : {}),
    };
  }

  async getWebhookSecret(tenantId: string): Promise<string | null> {
    const config = await this.wooRepo.findConfig(tenantId);
    if (!config) return null;
    return openSecret(config.webhookSecret, tenantId);
  }

  async importOrder(
    tenantId: string,
    order: WooCommerceOrderWebhookDto,
  ): Promise<{ success: boolean; invoiceId?: string; skipped?: boolean; reason?: string }> {
    const externalId = String(order.id);

    const config = await this.wooRepo.findConfig(tenantId);
    if (config && !config.autoSyncOrders) {
      return {
        success: true,
        skipped: true,
        reason: 'autoSyncOrders is disabled',
      };
    }

    // Validate currency explicitly (fail closed when missing or unsupported)
    const rawCurrency = order.currency?.trim().toUpperCase() || '';
    if (!rawCurrency || !SUPPORTED_ORDER_CURRENCIES.has(rawCurrency)) {
      throw new BadRequestException(
        rawCurrency
          ? `Unsupported WooCommerce order currency: ${rawCurrency}`
          : 'WooCommerce order currency is required',
      );
    }
    const orderCurrency = rawCurrency as Currency;
    const exchangeRate = this.currencyService.getRate(orderCurrency, BASE_CURRENCY);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new BadRequestException(`Missing valid exchange rate for currency ${orderCurrency}`);
    }
    const fxRate =
      orderCurrency === Currency.IRR
        ? 1
        : orderCurrency === Currency.IRT
          ? TOMAN_TO_RIAL
          : this.currencyService.getRate(orderCurrency, Currency.IRR);
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      throw new BadRequestException(`Missing valid IRR FX rate for currency ${orderCurrency}`);
    }

    const fromUnitsScaled = parseScaled(this.currencyService.unitsPerUsd(orderCurrency), 6);
    const toUnitsScaled = parseScaled(this.currencyService.unitsPerUsd(BASE_CURRENCY), 6);
    if (fromUnitsScaled <= 0n || toUnitsScaled <= 0n) {
      throw new BadRequestException(`Invalid FX units for currency ${orderCurrency}`);
    }
    const convertMinorToBase = (minor: bigint): bigint => {
      const neg = minor < 0n;
      const abs = neg ? -minor : minor;
      const converted = (abs * toUnitsScaled + fromUnitsScaled / 2n) / fromUnitsScaled;
      return neg ? -converted : converted;
    };

    try {
      const outcome = await this.wooRepo.withOrderLock(tenantId, externalId, async (manager) => {
        const existingLog = await this.wooRepo.findSyncLogByExternalId(
          tenantId,
          WooCommerceSyncDirection.INBOUND_ORDER,
          externalId,
          manager,
        );

        if (existingLog && existingLog.status === WooCommerceSyncStatus.SUCCESS) {
          return {
            success: true,
            skipped: true,
            invoiceId: existingLog.internalId || undefined,
            reason: 'Order already imported',
          };
        }

        const buyerName =
          [order.billing?.first_name, order.billing?.last_name]
            .filter(Boolean)
            .join(' ') ||
          order.billing?.company ||
          'مشتری ووکامرس';

        const buyerAddress = [
          order.billing?.state,
          order.billing?.city,
          order.billing?.address_1,
          order.billing?.postcode,
        ]
          .filter(Boolean)
          .join(' - ');

        const buyerInfo: InvoicePartyInfo = {
          name: buyerName,
          phone: order.billing?.phone || '',
          email: order.billing?.email || '',
          address: buyerAddress || '',
        };

        const tenant = await this.tenantsRepo.findById(tenantId);
        const sellerInfo: InvoicePartyInfo = {
          name: tenant?.name || 'فروشگاه اینترنتی',
        };

        const orderTotalMinor = parseWooAmount(order.total);
        const orderTaxMinor = parseWooAmount(order.total_tax);
        const orderDiscountMinor = parseWooAmount(order.discount_total);
        const shippingMinor = parseWooAmount(order.shipping_total);
        const shippingTaxMinor = parseWooAmount(order.shipping_tax);

        let sumLineDiscountsMinor = 0n;
        let sumLineTaxMinor = 0n;
        const items: InvoiceItem[] = (order.line_items || []).map((line) => {
          const { qty, scaledQty } = parseLineQuantity(line.quantity);
          const lineTotalMinor = parseWooAmount(line.total || line.subtotal);
          const lineSubtotalMinor = parseWooAmount(line.subtotal || line.total);
          const lineTaxMinor = parseWooAmount(line.total_tax);
          sumLineTaxMinor += lineTaxMinor;
          const lineDiscountMinor =
            lineSubtotalMinor > lineTotalMinor ? lineSubtotalMinor - lineTotalMinor : 0n;
          sumLineDiscountsMinor += lineDiscountMinor;

          let unitPriceMinor: bigint;
          if (line.price !== undefined && line.price !== null) {
            unitPriceMinor = parseWooAmount(String(line.price));
          } else {
            unitPriceMinor = scaledQty > 0n ? (lineSubtotalMinor * 10000n) / scaledQty : lineSubtotalMinor;
          }

          const vatRate = vatRateOf(lineTotalMinor, lineTaxMinor);

          return {
            sku: line.sku || `WOO-${line.product_id}`,
            description:
              qty === Math.floor(qty)
                ? line.name || `کالای ووکامرس #${line.product_id}`
                : `${line.name || `کالای ووکامرس #${line.product_id}`} (×${qty})`,
            quantity: qty,
            unitPrice: minorToNumber(unitPriceMinor),
            discount: minorToNumber(lineDiscountMinor),
            vatRate,
            tax: minorToNumber(lineTaxMinor),
            total: minorToNumber(lineTotalMinor + lineTaxMinor),
          };
        });

        if (shippingMinor > 0n || shippingTaxMinor > 0n) {
          items.push({
            sku: 'SHIPPING',
            description: 'هزینه ارسال سفارش',
            quantity: 1,
            unitPrice: minorToNumber(shippingMinor),
            discount: 0,
            vatRate: vatRateOf(shippingMinor, shippingTaxMinor),
            tax: minorToNumber(shippingTaxMinor),
            total: minorToNumber(shippingMinor + shippingTaxMinor),
          });
        }

        const totalTaxMinor =
          orderTaxMinor > 0n ? orderTaxMinor : sumLineTaxMinor + shippingTaxMinor;
        const totalDiscountMinor =
          orderDiscountMinor > 0n ? orderDiscountMinor : sumLineDiscountsMinor;
        // Net merchandise/shipping before tax and before discount so totalAmount - totalDiscount + totalTax === finalPayable
        const totalAmountMinor = orderTotalMinor - totalTaxMinor + totalDiscountMinor;
        const baseTotalAmountMinor = convertMinorToBase(totalAmountMinor);
        const baseTotalTaxMinor = convertMinorToBase(totalTaxMinor);
        const baseFinalPayableMinor = convertMinorToBase(orderTotalMinor);
        const jurisdiction =
          orderCurrency === Currency.IRR || orderCurrency === Currency.IRT
            ? InvoiceJurisdiction.IR
            : InvoiceJurisdiction.INTL;

        const taxInvoiceNumber = `WOO-${order.id}`;
        const einvoiceType = order.billing?.company
          ? EInvoiceType.WITH_BUYER
          : EInvoiceType.WITHOUT_BUYER;

        const invoice = await this.invoicingRepo.create(
          tenantId,
          {
            tenantId,
            taxInvoiceNumber,
            direction: InvoiceDirection.SALE,
            status: InvoiceStatus.DRAFT,
            currency: orderCurrency,
            jurisdiction,
            exchangeRate,
            fxRate,
            amountFx: minorToNumber(orderTotalMinor),
            baseCurrency: BASE_CURRENCY,
            baseTotalAmount: minorToNumber(baseTotalAmountMinor),
            baseTotalTax: minorToNumber(baseTotalTaxMinor),
            baseFinalPayable: minorToNumber(baseFinalPayableMinor),
            einvoiceType,
            subject: InvoiceSubject.ORIGINAL,
            sellerInfo,
            buyerInfo,
            items,
            totalAmount: minorToNumber(totalAmountMinor),
            totalDiscount: minorToNumber(totalDiscountMinor),
            totalTax: minorToNumber(totalTaxMinor),
            finalPayable: minorToNumber(orderTotalMinor),
          },
          manager,
        );

        await this.wooRepo.createSyncLog(
          tenantId,
          {
            direction: WooCommerceSyncDirection.INBOUND_ORDER,
            status: WooCommerceSyncStatus.SUCCESS,
            externalId,
            internalId: invoice.id,
            payloadSummary: {
              orderId: order.id,
              orderNumber: order.number || String(order.id),
              total: order.total,
              currency: orderCurrency,
              itemCount: items.length,
            },
          },
          manager,
        );

        return {
          success: true,
          invoiceId: invoice.id,
        };
      });

      if (!outcome.skipped) {
        try {
          await this.wooRepo.saveConfig(tenantId, { lastSyncAt: new Date() });
        } catch {
          // non-critical
        }
      }

      return outcome;
    } catch (err: any) {
      if (err?.code === '23505') {
        const existing = await this.wooRepo.findSyncLogByExternalId(
          tenantId,
          WooCommerceSyncDirection.INBOUND_ORDER,
          externalId,
        );
        if (existing?.internalId) {
          return {
            success: true,
            skipped: true,
            invoiceId: existing.internalId,
            reason: 'Order already imported concurrently',
          };
        }
      }
      this.logger.error(`Failed to import WooCommerce order #${externalId}: ${err?.message || err}`);
      await this.wooRepo.createSyncLog(tenantId, {
        direction: WooCommerceSyncDirection.INBOUND_ORDER,
        status: WooCommerceSyncStatus.FAILED,
        externalId,
        payloadSummary: { orderId: order.id, total: order.total },
        errorMessage: String(err?.message || err),
      });
      throw err;
    }
  }

  async pushStockUpdate(
    tenantId: string,
    sku: string,
    quantity: number,
    priceMinor?: bigint,
  ): Promise<{ success: boolean; externalId: string }> {
    const config = await this.wooRepo.findConfig(tenantId);
    if (!config) {
      throw new NotFoundException('WooCommerce not configured');
    }

    if (!config.autoSyncStock) {
      return { success: false, externalId: sku };
    }

    const parsed = assertSafeStoreUrl(config.storeUrl);
    const basePath = parsed.pathname.replace(/\/+$/, '');
    const origin = parsed.origin;

    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const verifyHostNotPrivate = async () => {
      if (net.isIP(host)) {
        if (PRIVATE_BLOCKLIST.check(host, net.isIP(host) === 4 ? 'ipv4' : 'ipv6')) {
          throw new BadRequestException('WooCommerce storeUrl resolves to a private or loopback address');
        }
        return;
      }
      const now = Date.now();
      const cached = dnsValidationCache.get(host);
      if (cached && cached.expiresAt > now) {
        if (!cached.valid) {
          throw new BadRequestException('WooCommerce storeUrl resolves to a private or loopback address');
        }
        return;
      }
      try {
        const resolved = await dns.lookup(host, { all: true });
        for (const addr of resolved) {
          if (PRIVATE_BLOCKLIST.check(addr.address, addr.family === 4 ? 'ipv4' : 'ipv6')) {
            dnsValidationCache.set(host, { valid: false, expiresAt: now + DNS_CACHE_TTL_MS });
            throw new BadRequestException('WooCommerce storeUrl resolves to a private or loopback address');
          }
        }
        dnsValidationCache.set(host, { valid: true, expiresAt: now + DNS_CACHE_TTL_MS });
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
      }
    };

    await verifyHostNotPrivate();

    const consumerKey = openSecret(config.consumerKeyEncrypted, tenantId);
    const consumerSecret = openSecret(config.consumerSecretEncrypted, tenantId);
    const authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;

    const payload: Record<string, any> = {
      sku,
      stock_quantity: quantity,
      manage_stock: true,
    };
    if (priceMinor !== undefined) {
      payload.regular_price = minorToDecimal(priceMinor);
    }

    try {
      const lookupRes = await fetch(
        `${origin}${basePath}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`,
        {
          method: 'GET',
          headers: { Authorization: authHeader },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!lookupRes.ok) {
        throw new BadGatewayException(`WooCommerce product lookup failed with ${lookupRes.status}`);
      }
      const products = (await lookupRes.json()) as Array<{ id: number }>;
      if (!Array.isArray(products) || products.length === 0) {
        throw new NotFoundException(`WooCommerce product not found for SKU ${sku}`);
      }

      await verifyHostNotPrivate();
      const updateRes = await fetch(`${origin}${basePath}/wp-json/wc/v3/products/${products[0].id}`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!updateRes.ok) {
        throw new BadGatewayException(`WooCommerce stock update failed with ${updateRes.status}`);
      }

      await this.wooRepo.createSyncLog(tenantId, {
        direction: WooCommerceSyncDirection.OUTBOUND_STOCK,
        status: WooCommerceSyncStatus.SUCCESS,
        externalId: sku,
        internalId: String(products[0].id),
        payloadSummary: payload,
      });

      return { success: true, externalId: sku };
    } catch (err: any) {
      await this.wooRepo.createSyncLog(tenantId, {
        direction: WooCommerceSyncDirection.OUTBOUND_STOCK,
        status: WooCommerceSyncStatus.FAILED,
        externalId: sku,
        errorMessage: String(err?.message || err),
        payloadSummary: { sku, quantity },
      });
      throw err;
    }
  }

  async listSyncLogs(
    tenantId: string,
    query: WooCommerceSyncLogQueryDto,
  ): Promise<{ items: WooCommerceSyncLogEntity[]; total: number }> {
    return this.wooRepo.listSyncLogs(tenantId, query);
  }
}
