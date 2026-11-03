import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { CustomerIdentityService } from '../../crm/services/customer-identity.service';
import { Currency } from '../../currency/enums/currency.enum';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { CreatePosSaleDto, PosSaleResponseDto } from '../dto/pos-sale.dto';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { InvoicingService } from './invoicing.service';

const UNIQUE_VIOLATION = '23505';

/**
 * One sale flow for the manual quick-sale form and a future POS API: customer (none, phone, or
 * name and phone), items by code or barcode, payments, and posting through the normal invoice
 * events (revenue, tax, cash/bank/POS clearing, COGS and stock). The idempotency key makes a retry
 * return the first invoice instead of posting again.
 */
@Injectable()
export class PosSaleService {
  constructor(
    private readonly invoicing: InvoicingService,
    private readonly invoicingRepository: InvoicingRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly customerIdentity: CustomerIdentityService,
    private readonly tenantsRepository: TenantsRepository,
  ) {}

  /** Hash of what the sale means, so the same key cannot be reused for a different sale. */
  private hashOf(dto: CreatePosSaleDto): string {
    const { idempotencyKey: _key, ...body } = dto;
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  private async replay(
    tenantId: string,
    key: string,
    hash: string,
  ): Promise<PosSaleResponseDto | null> {
    const existing = await this.invoicingRepository.findByIdempotencyKey(tenantId, key);
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== hash) {
      throw new ConflictException(
        'این کلید یکتا قبلاً برای فروش دیگری استفاده شده است.',
      );
    }
    return {
      invoice: await this.invoicing.findOne(tenantId, existing.id),
      replayed: true,
      customerLevel: existing.customerId ? 'phone' : 'anonymous',
      customerCreated: false,
    };
  }

  async createSale(tenantId: string, dto: CreatePosSaleDto): Promise<PosSaleResponseDto> {
    const hash = this.hashOf(dto);
    const replayed = await this.replay(tenantId, dto.idempotencyKey, hash);
    if (replayed) {
      return replayed;
    }

    const tenant = await this.tenantsRepository.findById(tenantId);
    const lines = await this.resolveLines(tenantId, dto);
    await this.assertStock(tenantId, lines, dto.warehouseId ?? null);

    const quote = await this.invoicing.quote(tenantId, {
      items: lines,
      currency: dto.currency,
      fxRate: dto.fxRate,
    });
    this.assertPaid(quote.totals.finalPayable, dto, quote.currency);

    const identity = await this.customerIdentity.resolve(
      tenantId,
      dto.customer,
      tenant?.countryCode ?? 'IR',
    );
    const invoiceDto: CreateInvoiceDto = {
      sellerInfo: { name: tenant?.name ?? 'سازمان من' },
      items: lines,
      status: InvoiceStatus.PAID,
      currency: dto.currency,
      fxRate: dto.fxRate,
      warehouseId: dto.warehouseId,
      // Anonymous sales name no customer: the invoice service attaches the walk-in customer and
      // picks the country's anonymous type. A known customer is passed by id.
      ...(identity.level === 'anonymous' ? {} : { customerId: identity.lead.id }),
    };

    try {
      const invoice = await this.invoicing.create(tenantId, invoiceDto, {
        idempotencyKey: dto.idempotencyKey,
        requestHash: hash,
        payments: dto.payments.map((p) => ({ method: p.method, amount: p.amount })),
      });
      return {
        invoice,
        replayed: false,
        customerLevel: identity.level,
        customerCreated: identity.created,
      };
    } catch (error) {
      // A concurrent retry with the same key won the unique index: return its invoice.
      if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
        const winner = await this.replay(tenantId, dto.idempotencyKey, hash);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** Lines with codes/barcodes resolved to stock items; a code that matches nothing is a 404. */
  private async resolveLines(
    tenantId: string,
    dto: CreatePosSaleDto,
  ): Promise<NonNullable<CreateInvoiceDto['items']>> {
    const lines: NonNullable<CreateInvoiceDto['items']> = [];
    for (const line of dto.lines) {
      const code = line.code?.trim();
      if (!code) {
        if (!line.description?.trim()) {
          throw new BadRequestException('هر سطر کد/بارکد کالا یا شرح دارد.');
        }
        lines.push({
          description: line.description.trim(),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          vatRate: line.vatRate,
        });
        continue;
      }
      const item = await this.inventoryRepository.findStockItemByCode(tenantId, code);
      if (!item) {
        throw new NotFoundException(`کالایی با کد یا بارکد ${code} یافت نشد.`);
      }
      lines.push({
        itemId: item.id,
        sku: item.sku,
        description: line.description?.trim() || item.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        vatRate: line.vatRate,
      });
    }
    return lines;
  }

  /** The sale cannot take more of an item than is on the shelf (posting would fail later otherwise). */
  private async assertStock(
    tenantId: string,
    lines: NonNullable<CreateInvoiceDto['items']>,
    warehouseId: number | null,
  ): Promise<void> {
    const wanted = new Map<string, number>();
    for (const line of lines) {
      if (line.sku) {
        wanted.set(line.sku, (wanted.get(line.sku) ?? 0) + line.quantity);
      }
    }
    for (const [sku, quantity] of wanted) {
      const available = await this.inventoryRepository.availableQuantity(tenantId, sku, warehouseId);
      if (quantity > available + 1e-9) {
        throw new BadRequestException(
          `موجودی کالای ${sku} کافی نیست. درخواستی: ${quantity}، موجود: ${available}.`,
        );
      }
    }
  }

  /** Payments must add up to the payable (whole rials for IRR, cents otherwise). */
  private assertPaid(payable: number, dto: CreatePosSaleDto, currency: Currency): void {
    const paid = dto.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const tolerance = currency === Currency.IRR ? 0 : 0.005;
    if (Math.abs(paid - payable) > tolerance) {
      throw new BadRequestException(
        `جمع پرداخت‌ها (${paid}) با مبلغ قابل پرداخت (${payable}) برابر نیست.`,
      );
    }
  }
}
