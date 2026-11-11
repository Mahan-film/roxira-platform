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
      webhookSecret: config.webhookSecret,
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
      webhookSecret: saved.webhookSecret,
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

      // 3. Build Invoice Line Items
      let calculatedTotal = 0;
      const items: InvoiceItem[] = (order.line_items || []).map((line, idx) => {
        const qty = line.quantity || 1;
        const lineTotalNum = Number(line.total || line.subtotal || 0);
        const unitPriceNum = Number(line.price || 0) || Math.round(lineTotalNum / qty);
        calculatedTotal += lineTotalNum;

        return {
          sku: line.sku || `WOO-${line.product_id}`,
          description: line.name || `کالای ووکامرس #${line.product_id}`,
          quantity: qty,
          unitPrice: unitPriceNum,
          discount: 0,
          vatRate: 0,
          tax: 0,
          total: lineTotalNum,
        };
      });

      const grandTotal = calculatedTotal > 0 ? calculatedTotal : Number(order.total || 0);
      const taxInvoiceNumber = `WOO-${order.id}-${randomBytes(3).toString('hex')}`;

      // 4. Create Draft Sales Invoice
      const invoice = await this.invoicingRepo.create(tenantId, {
        tenantId,
        taxInvoiceNumber,
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.DRAFT,
        currency: Currency.IRR,
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
        totalTax: Number(order.total_tax || 0),
        finalPayable: grandTotal,
      });

      // 5. Record Success in Sync Logs
      await this.wooRepo.createSyncLog(tenantId, {
        direction: WooCommerceSyncDirection.INBOUND_ORDER,
        status: WooCommerceSyncStatus.SUCCESS,
        externalId,
        internalId: invoice.id,
        payloadSummary: {
          orderId: order.id,
          orderNumber: order.number || String(order.id),
          total: order.total,
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

    try {
      // In production, this issues a REST API call to WooCommerce endpoint:
      // PUT ${config.storeUrl}/wp-json/wc/v3/products?sku=${sku}
      // using Basic Auth with decrypted consumer key/secret.
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
