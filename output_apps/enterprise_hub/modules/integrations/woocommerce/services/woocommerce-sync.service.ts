import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Currency } from '../../../currency/enums/currency.enum';
import { InvoiceJurisdiction } from '../../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceDirection } from '../../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoiceItem, InvoicePartyInfo } from '../../../invoicing/entities/invoice.entity';
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
import { maskApiKey, openSecret, sealSecret } from '../utils/woocommerce-crypto.util';
import { toMinor, fromMinor } from '../../../accounting/money';

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
    let maskedKey = '';
    let hasSecret = false;
    try {
      const openKey = openSecret(config.consumerKeyEncrypted, tenantId);
      maskedKey = maskApiKey(openKey);
      hasSecret = Boolean(config.consumerSecretEncrypted);
    } catch (err) {
      this.logger.warn(`Failed to decrypt WooCommerce consumer key: ${err}`);
      maskedKey = 'ck_...****';
    }

    return {
      storeUrl: config.storeUrl,
      maskedConsumerKey: maskedKey,
      hasConsumerSecret: hasSecret,
      webhookSecret: maskApiKey(config.webhookSecret),
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
    if (!dto.storeUrl || !dto.consumerKey || !dto.consumerSecret) {
      throw new BadRequestException('storeUrl, consumerKey, and consumerSecret are required');
    }

    const keyEncrypted = sealSecret(dto.consumerKey.trim(), tenantId);
    const secretEncrypted = sealSecret(dto.consumerSecret.trim(), tenantId);
    const webhookSecret = dto.webhookSecret?.trim() || randomBytes(24).toString('hex');

    const saved = await this.wooRepo.saveConfig(tenantId, {
      storeUrl: dto.storeUrl.trim(),
      consumerKeyEncrypted: keyEncrypted,
      consumerSecretEncrypted: secretEncrypted,
      webhookSecret,
      autoSyncOrders: dto.autoSyncOrders !== undefined ? dto.autoSyncOrders : true,
      autoSyncStock: dto.autoSyncStock !== undefined ? dto.autoSyncStock : true,
    });

    return {
      storeUrl: saved.storeUrl,
      maskedConsumerKey: maskApiKey(dto.consumerKey.trim()),
      hasConsumerSecret: true,
      webhookSecret: maskApiKey(saved.webhookSecret),
      webhookUrl: `/api/integrations/woocommerce/webhook/${tenantId}`,
      autoSyncOrders: saved.autoSyncOrders,
      autoSyncStock: saved.autoSyncStock,
      lastSyncAt: saved.lastSyncAt,
      updatedAt: saved.updatedAt,
    };
  }

  async getWebhookSecret(tenantId: string): Promise<string | null> {
    const config = await this.wooRepo.findConfig(tenantId);
    return config ? config.webhookSecret : null;
  }

  async importOrder(
    tenantId: string,
    order: WooCommerceOrderWebhookDto,
  ): Promise<{ success: boolean; invoiceId?: string; skipped?: boolean; reason?: string }> {
    const externalId = String(order.id);

    // 0. Auto-sync check
    const config = await this.wooRepo.findConfig(tenantId);
    if (config && !config.autoSyncOrders) {
      return {
        success: true,
        skipped: true,
        reason: 'autoSyncOrders is disabled',
      };
    }

    // 1. Idempotency Check on the WooCommerce Order ID
    const existingLog = await this.wooRepo.findSyncLogByExternalId(
      tenantId,
      WooCommerceSyncDirection.INBOUND_ORDER,
      externalId,
    );

    if (existingLog && existingLog.status === WooCommerceSyncStatus.SUCCESS) {
      this.logger.log(`Order #${externalId} already imported into invoice ${existingLog.internalId}`);
      return {
        success: true,
        skipped: true,
        invoiceId: existingLog.internalId || undefined,
        reason: 'Order already imported',
      };
    }

    try {
      // 2. Build Invoice Party Info (Buyer)
      const buyerName = [order.billing?.first_name, order.billing?.last_name]
        .filter(Boolean)
        .join(' ') || order.billing?.company || 'مشتری ووکامرس';

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

      // 3. Currency and BigInt minor units via money.ts
      const orderCurrency = (order.currency || 'IRR').toUpperCase() === 'IRT' ? Currency.IRT : Currency.IRR;
      const orderTotalMinor = toMinor(order.total || '0');
      const totalTaxMinor = toMinor(order.total_tax || '0');

      // 4. Build Invoice Line Items
      const items: InvoiceItem[] = (order.line_items || []).map((line) => {
        const qty = Math.max(1, line.quantity || 1);
        const lineTotalMinor = toMinor(line.total || line.subtotal || '0');
        const unitPriceMinor = line.price !== undefined ? toMinor(String(line.price)) : lineTotalMinor / BigInt(qty);

        return {
          sku: line.sku || `WOO-${line.product_id}`,
          description: line.name || `کالای ووکامرس #${line.product_id}`,
          quantity: qty,
          unitPrice: Number(fromMinor(unitPriceMinor)),
          discount: 0,
          vatRate: 0,
          tax: 0,
          total: Number(fromMinor(lineTotalMinor)),
        };
      });

      const grandTotal = Number(fromMinor(orderTotalMinor));
      const totalTax = Number(fromMinor(totalTaxMinor));
      const taxInvoiceNumber = `WOO-${order.id}`;

      // 5. Create Draft Sales Invoice
      const invoice = await this.invoicingRepo.create(tenantId, {
        tenantId,
        taxInvoiceNumber,
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.DRAFT,
        currency: orderCurrency,
        jurisdiction: InvoiceJurisdiction.IR,
        exchangeRate: 1,
        fxRate: 1,
        baseCurrency: Currency.USD,
        baseTotalAmount: 0,
        baseTotalTax: 0,
        baseFinalPayable: 0,
        einvoiceType: 1,
        subject: 1,
        sellerInfo,
        buyerInfo,
        items,
        totalAmount: grandTotal,
        totalDiscount: 0,
        totalTax,
        finalPayable: grandTotal,
      });

      // 6. Record Success in Sync Logs
      await this.wooRepo.createSyncLog(tenantId, {
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
      });

      // Update lastSyncAt on config
      try {
        await this.wooRepo.saveConfig(tenantId, { lastSyncAt: new Date() });
      } catch {
        // non-critical
      }

      return {
        success: true,
        invoiceId: invoice.id,
      };
    } catch (err: any) {
      if (err?.code === '23505') {
        // Duplicate key (concurrency race on external_id or taxInvoiceNumber)
        const existing = await this.wooRepo.findSyncLogByExternalId(
          tenantId,
          WooCommerceSyncDirection.INBOUND_ORDER,
          externalId,
        );
        return {
          success: true,
          skipped: true,
          invoiceId: existing?.internalId || undefined,
          reason: 'Order already imported concurrently',
        };
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

    try {
      const payload: Record<string, any> = {
        sku,
        stock_quantity: quantity,
        manage_stock: true,
      };
      if (priceMinor !== undefined) {
        payload.regular_price = fromMinor(priceMinor).toString();
      }

      await this.wooRepo.createSyncLog(tenantId, {
        direction: WooCommerceSyncDirection.OUTBOUND_STOCK,
        status: WooCommerceSyncStatus.SUCCESS,
        externalId: sku,
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
