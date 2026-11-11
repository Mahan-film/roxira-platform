import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PRINT_DOC_TYPE_LABELS,
  PRINT_PAPER_SIZE_LABELS,
  PrintDocType,
  PrintPaperSize,
} from '../enums/print-template.enum';
import {
  PrintColumnConfig,
  PrintTemplateEntity,
  PrintTemplateOptions,
} from '../entities/print-template.entity';
import { PrintTemplateRepository } from '../repositories/print-template.repository';
import {
  BarcodeLabelItemDto,
  CreatePrintTemplateDto,
  PrintColumnConfigDto,
  PrintTemplateResponseDto,
  QueryPrintTemplateDto,
  RenderBarcodeSheetDto,
  UpdatePrintTemplateDto,
} from '../dto/print-template.dto';
import { toMinor } from '../../accounting/money';
import { formatMoney } from '../../accounting/reports/pdf-writer';
import { generateBarcodeSvg } from './barcode.helper';

export const DEFAULT_COLUMNS_CONFIG: Record<PrintDocType, PrintColumnConfig[]> = {
  [PrintDocType.SALES_INVOICE]: [
    { key: 'rowNumber', label: 'ردیف', visible: true, order: 1, widthPercent: 6 },
    { key: 'itemCode', label: 'کد کالا/خدمت', visible: true, order: 2, widthPercent: 12 },
    { key: 'description', label: 'شرح کالا یا خدمات', visible: true, order: 3, widthPercent: 30 },
    { key: 'quantity', label: 'تعداد / مقدار', visible: true, order: 4, widthPercent: 8 },
    { key: 'unit', label: 'واحد', visible: true, order: 5, widthPercent: 8 },
    { key: 'unitPrice', label: 'مبلغ واحد (ریال)', visible: true, order: 6, widthPercent: 12 },
    { key: 'discount', label: 'تخفیف (ریال)', visible: true, order: 7, widthPercent: 10 },
    { key: 'vat', label: 'مالیات و عوارض', visible: true, order: 8, widthPercent: 10 },
    { key: 'totalPrice', label: 'مبلغ کل (ریال)', visible: true, order: 9, widthPercent: 14 },
  ],
  [PrintDocType.RECEIPT_PAYMENT_VOUCHER]: [
    { key: 'rowNumber', label: 'ردیف', visible: true, order: 1, widthPercent: 8 },
    { key: 'type', label: 'نوع عملیات', visible: true, order: 2, widthPercent: 16 },
    { key: 'trackingNumber', label: 'شماره پیگیری / صیاد / فیش', visible: true, order: 3, widthPercent: 20 },
    { key: 'bankAccount', label: 'حساب / صندوق / بانک', visible: true, order: 4, widthPercent: 20 },
    { key: 'amount', label: 'مبلغ (ریال)', visible: true, order: 5, widthPercent: 16 },
    { key: 'description', label: 'شرح ردیف', visible: true, order: 6, widthPercent: 20 },
  ],
  [PrintDocType.STOCK_DOCUMENT]: [
    { key: 'rowNumber', label: 'ردیف', visible: true, order: 1, widthPercent: 8 },
    { key: 'itemCode', label: 'کد کالا', visible: true, order: 2, widthPercent: 14 },
    { key: 'itemName', label: 'شرح کالا', visible: true, order: 3, widthPercent: 30 },
    { key: 'warehouse', label: 'انبار', visible: true, order: 4, widthPercent: 14 },
    { key: 'unit', label: 'واحد سنجش', visible: true, order: 5, widthPercent: 10 },
    { key: 'quantity', label: 'مقدار', visible: true, order: 6, widthPercent: 10 },
    { key: 'totalCost', label: 'بهای کل (ریال)', visible: true, order: 7, widthPercent: 14 },
  ],
  [PrintDocType.BARCODE_LABELS]: [
    { key: 'title', label: 'نام کالا', visible: true, order: 1 },
    { key: 'sku', label: 'کد کالا / SKU', visible: true, order: 2 },
    { key: 'barcode', label: 'بارکد', visible: true, order: 3 },
    { key: 'price', label: 'قیمت مصرف‌کننده', visible: true, order: 4 },
  ],
};

@Injectable()
export class PrintTemplateService {
  constructor(private readonly repository: PrintTemplateRepository) {}

  async create(
    tenantId: string,
    dto: CreatePrintTemplateDto,
  ): Promise<PrintTemplateResponseDto> {
    const existing = await this.repository.findByTitle(tenantId, dto.title.trim());
    if (existing) {
      throw new ConflictException(
        `قالب چاپی با عنوان «${dto.title}» قبلاً برای این سازمان تعریف شده است.`,
      );
    }

    const columnsConfig =
      dto.columnsConfig && dto.columnsConfig.length > 0
        ? dto.columnsConfig
        : DEFAULT_COLUMNS_CONFIG[dto.docType] ?? [];

    const options: PrintTemplateOptions = {
      barcodeColumns: dto.docType === PrintDocType.BARCODE_LABELS ? 4 : undefined,
      showPrice: true,
      showSku: true,
      showSignatures: true,
      signatures: ['تنظیم‌کننده', 'تأییدکننده', 'دریافت‌کننده'],
      ...(dto.options ?? {}),
    };

    let saved: PrintTemplateEntity;
    try {
      saved = await this.repository.saveWithDefault(
        tenantId,
        {
          docType: dto.docType,
          paperSize: dto.paperSize,
          title: dto.title.trim(),
          showLogo: dto.showLogo !== undefined ? Boolean(dto.showLogo) : true,
          logoUrl: dto.logoUrl ?? null,
          columnsConfig,
          options,
        },
        Boolean(dto.isDefault),
      );
    } catch (err: any) {
      if (err?.code === '23505' || err?.message?.includes('UQ_inv_print_templates_tenant_title')) {
        throw new ConflictException(`قالب چاپی با عنوان «${dto.title}» قبلاً برای این سازمان تعریف شده است.`);
      }
      throw err;
    }

    return this.toDto(saved);
  }

  async update(
    tenantId: string,
    id: number,
    dto: UpdatePrintTemplateDto,
  ): Promise<PrintTemplateResponseDto> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`قالب چاپی با شناسه ${id} یافت نشد.`);
    }

    if (dto.title !== undefined) {
      if (dto.title === null || typeof dto.title !== 'string' || !dto.title.trim()) {
        throw new BadRequestException('عنوان قالب نمی‌تواند خالی یا تهی باشد.');
      }
      if (dto.title.trim() !== existing.title) {
        const duplicate = await this.repository.findByTitle(tenantId, dto.title.trim());
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(
            `قالب چاپی دیگری با عنوان «${dto.title}» قبلاً ثبت شده است.`,
          );
        }
      }
    }

    if (dto.columnsConfig !== undefined) {
      if (dto.columnsConfig === null || !Array.isArray(dto.columnsConfig)) {
        throw new BadRequestException('پیکربندی ستون‌ها نمی‌تواند تهی باشد.');
      }
    }

    let updated: PrintTemplateEntity;
    try {
      updated = await this.repository.saveWithDefault(
        tenantId,
        {
          docType: existing.docType,
          paperSize: existing.paperSize,
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.showLogo !== undefined ? { showLogo: Boolean(dto.showLogo) } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
          ...(dto.columnsConfig !== undefined ? { columnsConfig: dto.columnsConfig } : {}),
          ...(dto.options !== undefined ? { options: { ...existing.options, ...dto.options } } : {}),
        },
        dto.isDefault !== undefined ? Boolean(dto.isDefault) : existing.isDefault,
        id,
      );
    } catch (err: any) {
      if (err?.code === '23505' || err?.message?.includes('UQ_inv_print_templates_tenant_title')) {
        throw new ConflictException(`قالب چاپی با عنوان «${dto.title}» قبلاً برای این سازمان تعریف شده است.`);
      }
      throw err;
    }

    return this.toDto(updated);
  }

  async findOne(tenantId: string, id: number): Promise<PrintTemplateResponseDto> {
    const item = await this.repository.findById(tenantId, id);
    if (!item) {
      throw new NotFoundException(`قالب چاپی با شناسه ${id} یافت نشد.`);
    }
    return this.toDto(item);
  }

  async findDefault(
    tenantId: string,
    docType: PrintDocType,
    paperSize?: PrintPaperSize,
  ): Promise<PrintTemplateResponseDto> {
    const saved = await this.repository.findDefault(tenantId, docType, paperSize);
    if (saved) return this.toDto(saved);

    // If no custom template is saved as default, return the system default preset
    const chosenSize = paperSize ?? (docType === PrintDocType.RECEIPT_PAYMENT_VOUCHER ? PrintPaperSize.A5 : PrintPaperSize.A4);
    return {
      id: 0,
      docType,
      docTypeLabel: PRINT_DOC_TYPE_LABELS[docType] ?? docType,
      paperSize: chosenSize,
      paperSizeLabel: PRINT_PAPER_SIZE_LABELS[chosenSize] ?? chosenSize,
      title: `قالب استاندارد ${PRINT_DOC_TYPE_LABELS[docType]} (${PRINT_PAPER_SIZE_LABELS[chosenSize]})`,
      isDefault: true,
      showLogo: true,
      logoUrl: null,
      columnsConfig: DEFAULT_COLUMNS_CONFIG[docType] ?? [],
      options: {
        barcodeColumns: 4,
        showPrice: true,
        showSku: true,
        showSignatures: true,
        signatures: ['تنظیم‌کننده', 'تأییدکننده', 'دریافت‌کننده'],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async list(
    tenantId: string,
    query: QueryPrintTemplateDto,
  ): Promise<PrintTemplateResponseDto[]> {
    const list = await this.repository.list(tenantId, query);
    return list.map((item) => this.toDto(item));
  }

  async remove(tenantId: string, id: number): Promise<{ success: boolean; id: number }> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`قالب چاپی با شناسه ${id} یافت نشد.`);
    }
    await this.repository.delete(tenantId, id);
    return { success: true, id };
  }

  /**
   * تولید شیت چاپ برچسب بارکد به صورت ۴ یا ۵ ستونه بر روی صفحه A4
   */
  renderBarcodeLabelSheetHtml(dto: RenderBarcodeSheetDto): string {
    const cols = dto.columns === 5 ? 5 : 4;
    const showPrice = dto.showPrice !== false;
    const showSku = dto.showSku !== false;

    let totalCount = 0;
    for (const item of dto.items) {
      totalCount += item.count ?? 1;
    }
    if (totalCount > 500) {
      throw new BadRequestException('حداکثر ۵۰۰ برچسب در یک درخواست مجاز است.');
    }

    const formatPriceRials = (amount?: string): string => {
      if (!amount) return '';
      const minor = toMinor(amount);
      return `${formatMoney(minor)} ریال`;
    };

    // Flatten items according to their requested count
    const labelItems: BarcodeLabelItemDto[] = [];
    for (const item of dto.items) {
      const count = Math.max(1, Math.min(100, item.count ?? 1));
      for (let i = 0; i < count; i++) {
        labelItems.push(item);
      }
    }

    const colWidth = cols === 5 ? '19.2%' : '24%';
    const labelHeightMm = cols === 5 ? '32mm' : '36mm';

    const labelsHtml = labelItems
      .map((item) => {
        const barcodeVal = item.barcode?.trim() || item.sku.trim();
        const priceStr = showPrice && item.price ? formatPriceRials(item.price) : '';
        const barcodeResult = generateBarcodeSvg(barcodeVal, 24);

        return `
          <div class="barcode-label" style="width: ${colWidth}; height: ${labelHeightMm};">
            <div class="label-title" title="${escapeXml(item.title)}">${escapeXml(item.title)}</div>
            ${showSku ? `<div class="label-sku">کد: ${escapeXml(item.sku)}</div>` : ''}
            <div class="label-barcode-box">
              ${barcodeResult.svg}
              <div class="label-barcode-digits">${escapeXml(barcodeVal)}</div>
            </div>
            ${priceStr ? `<div class="label-price">${priceStr}</div>` : ''}
          </div>
        `;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>شیت برچسب بارکد کالا (${cols} ستونه A4)</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 6mm 4mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Vazirmatn", Tahoma, sans-serif;
      font-size: 8pt;
      background: #fff;
      color: #000;
      direction: rtl;
    }
    .sheet-container {
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: 2mm 1.5mm;
      width: 100%;
      margin: 0 auto;
    }
    .barcode-label {
      border: 1px dashed #bbb;
      border-radius: 4px;
      padding: 2.5mm 2mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      page-break-inside: avoid;
      background: #fff;
      overflow: hidden;
    }
    .label-title {
      font-weight: 700;
      font-size: 7.5pt;
      line-height: 1.2;
      max-height: 2.4em;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      width: 100%;
    }
    .label-sku {
      font-size: 6.5pt;
      color: #444;
      font-family: monospace;
      margin-top: 1px;
    }
    .label-barcode-box {
      width: 90%;
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 2px 0;
    }
    .barcode-svg {
      width: 100%;
      height: 22px;
      display: block;
    }
    .label-barcode-digits {
      font-family: monospace;
      font-size: 7pt;
      letter-spacing: 1.5px;
      margin-top: 1px;
    }
    .label-price {
      font-size: 8pt;
      font-weight: 800;
      color: #111;
      border-top: 1px solid #ddd;
      width: 100%;
      padding-top: 1.5px;
    }
    @media print {
      body {
        margin: 0;
      }
      .barcode-label {
        border: 1px dashed #ccc;
      }
    }
  </style>
</head>
<body>
  <div class="sheet-container">
    ${labelsHtml}
  </div>
</body>
</html>`;
  }

  private toDto(entity: PrintTemplateEntity): PrintTemplateResponseDto {
    return {
      id: entity.id,
      docType: entity.docType,
      docTypeLabel: PRINT_DOC_TYPE_LABELS[entity.docType] ?? entity.docType,
      paperSize: entity.paperSize,
      paperSizeLabel: PRINT_PAPER_SIZE_LABELS[entity.paperSize] ?? entity.paperSize,
      title: entity.title,
      isDefault: entity.isDefault,
      showLogo: entity.showLogo,
      logoUrl: entity.logoUrl,
      columnsConfig: entity.columnsConfig,
      options: entity.options,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

function escapeXml(unsafe: string): string {
  return (unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
