import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { fromMinor, toMinor } from '../../../accounting/money';
import { BASE_CURRENCY } from '../../../currency/constants/currency.constants';
import { Currency } from '../../../currency/enums/currency.enum';
import { InvoiceItem, InvoicePartyInfo } from '../../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceDirection } from '../../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../../invoicing/repositories/invoicing.repository';
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
  assertSafeStoreUrl,
  maskApiKey,
  openSecret,
  sealSecret,
} from '../utils/woocommerce-crypto.util';

const SUPPORTED_ORDER_CURRENCIES = new Set<string>(Object.values(Currency));

function isMaskedSecretInput(value?: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === '****' || trimmed.includes('...');
}

@Injectable()
export class WooCommerceSyncService {
  private readonly logger = new Logger(WooCommerceSyncService.name);

  constructor(
    private readonly wooRepo: WooCommerceRepository,
    private readonly invoicingRepo: InvoicingRepository,
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
      webhookUrl: `/api/integrations/woocommerce/webhook/${tenantId}`,
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
    if (!isMaskedSecretInput(dto.webhookSecret)) {
      webhookSecretEncrypted = sealSecret(dto.webhookSecret!.trim(), tenantId);
    } else if (existing?.webhookSecret) {
      webhookSecretEncrypted = existing.webhookSecret;
    } else {
      webhookSecretEncrypted = sealSecret(randomBytes(24).toString('hex'), tenantId);
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
      webhookUrl: `/api/integrations/woocommerce/webhook/${tenantId}`,
      autoSyncOrders: saved.autoSyncOrders,
      autoSyncStock: saved.autoSyncStock,
      lastSyncAt: saved.lastSyncAt,
      updatedAt: saved.updatedAt,
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

    // Validate currency before entering lock/transaction
    const rawCurrency = (order.currency || 'IRR').trim().toUpperCase();
    if (!SUPPORTED_ORDER_CURRENCIES.has(rawCurrency)) {
      throw new BadRequestException(`Unsupported WooCommerce order currency: ${rawCurrency}`);
    }
    const orderCurrency = rawCurrency as Currency;

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

        const sellerInfo: InvoicePartyInfo = {
          name: 'فروشگاه اینترنتی ووکامرس',
        };

        const orderTotalMinor = toMinor(order.total || '0');
        const totalTaxMinor = toMinor(order.total_tax || '0');
        const orderDiscountMinor = toMinor(order.discount_total || '0');

        let sumLineDiscountsMinor = 0n;
        const items: InvoiceItem[] = (order.line_items || []).map((line) => {
          const rawQty = Math.max(1, line.quantity || 1);
          const lineTotalMinor = toMinor(line.total || line.subtotal || '0');
          const lineSubtotalMinor = toMinor(line.subtotal || line.total || '0');
          const lineTaxMinor = toMinor(line.total_tax || '0');
          const lineDiscountMinor =
            lineSubtotalMinor > lineTotalMinor ? lineSubtotalMinor - lineTotalMinor : 0n;
          sumLineDiscountsMinor += lineDiscountMinor;

          let qty = rawQty;
          let unitPriceMinor: bigint;
          if (line.price !== undefined && line.price !== null) {
            unitPriceMinor = toMinor(String(line.price));
          } else if (lineSubtotalMinor % BigInt(rawQty) === 0n) {
            unitPriceMinor = lineSubtotalMinor / BigInt(rawQty);
          } else {
            // Avoid rounding error when subtotal is not evenly divisible by quantity
            unitPriceMinor = lineSubtotalMinor;
            qty = 1;
          }

          const vatRate =
            lineTotalMinor > 0n && lineTaxMinor > 0n
              ? Number((lineTaxMinor * 10000n) / lineTotalMinor) / 10000
              : 0;

          return {
            sku: line.sku || `WOO-${line.product_id}`,
            description:
              qty === rawQty
                ? line.name || `کالای ووکامرس #${line.product_id}`
                : `${line.name || `کالای ووکامرس #${line.product_id}`} (×${rawQty})`,
            quantity: qty,
            unitPrice: fromMinor(unitPriceMinor) as number,
            discount: fromMinor(lineDiscountMinor) as number,
            vatRate,
            tax: fromMinor(lineTaxMinor) as number,
            total: fromMinor(lineTotalMinor + lineTaxMinor) as number,
          };
        });

        const totalDiscountMinor =
          orderDiscountMinor > 0n ? orderDiscountMinor : sumLineDiscountsMinor;
        // Net merchandise/shipping before tax and before discount so totalAmount - totalDiscount + totalTax === finalPayable
        const totalAmountMinor = orderTotalMinor - totalTaxMinor + totalDiscountMinor;
        const jurisdiction =
          orderCurrency === Currency.IRR || orderCurrency === Currency.IRT
            ? InvoiceJurisdiction.IR
            : InvoiceJurisdiction.INTL;

        const taxInvoiceNumber = `WOO-${order.id}`;

        const invoice = await this.invoicingRepo.create(
          tenantId,
          {
            tenantId,
            taxInvoiceNumber,
            direction: InvoiceDirection.SALE,
            status: InvoiceStatus.DRAFT,
            currency: orderCurrency,
            jurisdiction,
            exchangeRate: 1,
            fxRate: 1,
            baseCurrency: BASE_CURRENCY,
            baseTotalAmount: 0,
            baseTotalTax: 0,
            baseFinalPayable: 0,
            einvoiceType: 1,
            subject: 1,
            sellerInfo,
            buyerInfo,
            items,
            totalAmount: fromMinor(totalAmountMinor) as number,
            totalDiscount: fromMinor(totalDiscountMinor) as number,
            totalTax: fromMinor(totalTaxMinor) as number,
            finalPayable: fromMinor(orderTotalMinor) as number,
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
              buyer: buyerName,
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

    const safeBase = assertSafeStoreUrl(config.storeUrl).origin;
    const consumerKey = openSecret(config.consumerKeyEncrypted, tenantId);
    const consumerSecret = openSecret(config.consumerSecretEncrypted, tenantId);
    const authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;

    const payload: Record<string, any> = {
      sku,
      stock_quantity: quantity,
      manage_stock: true,
    };
    if (priceMinor !== undefined) {
      payload.regular_price = String(fromMinor(priceMinor));
    }

    try {
      const lookupRes = await fetch(
        `${safeBase}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`,
        {
          method: 'GET',
          headers: { Authorization: authHeader },
        },
      );
      if (!lookupRes.ok) {
        throw new BadGatewayException(`WooCommerce product lookup failed with ${lookupRes.status}`);
      }
      const products = (await lookupRes.json()) as Array<{ id: number }>;
      if (!Array.isArray(products) || products.length === 0) {
        throw new NotFoundException(`WooCommerce product not found for SKU ${sku}`);
      }

      const updateRes = await fetch(`${safeBase}/wp-json/wc/v3/products/${products[0].id}`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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
