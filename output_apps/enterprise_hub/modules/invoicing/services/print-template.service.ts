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

    if (dto.isDefault) {
      await this.repository.clearDefault(tenantId, dto.docType, dto.paperSize);
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

    const saved = await this.repository.createTemplate(tenantId, {
      docType: dto.docType,
      paperSize: dto.paperSize,
      title: dto.title.trim(),
      isDefault: Boolean(dto.isDefault),
      showLogo: dto.showLogo !== undefined ? Boolean(dto.showLogo) : true,
      logoUrl: dto.logoUrl ?? null,
      columnsConfig,
      options,
    });

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

    if (dto.title && dto.title.trim() !== existing.title) {
      const duplicate = await this.repository.findByTitle(tenantId, dto.title.trim());
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `قالب چاپی دیگری با عنوان «${dto.title}» قبلاً ثبت شده است.`,
        );
      }
    }

    if (dto.isDefault) {
      await this.repository.clearDefault(
        tenantId,
        existing.docType,
        existing.paperSize,
        id,
      );
    }

    const data: Partial<PrintTemplateEntity> = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.isDefault !== undefined) data.isDefault = Boolean(dto.isDefault);
    if (dto.showLogo !== undefined) data.showLogo = Boolean(dto.showLogo);
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.columnsConfig !== undefined) data.columnsConfig = dto.columnsConfig;
    if (dto.options !== undefined) {
      data.options = { ...existing.options, ...dto.options };
    }

    const updated = await this.repository.updateTemplate(tenantId, id, data);
    if (!updated) {
      throw new NotFoundException(`قالب چاپی با شناسه ${id} یافت نشد.`);
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

    // Flatten items according to their requested count
    const labelItems: BarcodeLabelItemDto[] = [];
    for (const item of dto.items) {
      const count = Math.max(1, Math.min(500, item.count ?? 1));
      for (let i = 0; i < count; i++) {
        labelItems.push(item);
      }
    }

    const colWidth = cols === 5 ? '19.2%' : '24%';
    const labelHeightMm = cols === 5 ? '32mm' : '36mm';

    const formatPriceRials = (amount?: number): string => {
      if (amount === undefined || amount === null) return '';
      return `${amount.toLocaleString('fa-IR')} ریال`;
    };

    const labelsHtml = labelItems
      .map((item) => {
        const barcodeVal = item.barcode?.trim() || item.sku.trim();
        const priceStr = showPrice && item.price !== undefined ? formatPriceRials(item.price) : '';
        return `
          <div class="barcode-label" style="width: ${colWidth}; height: ${labelHeightMm};">
            <div class="label-title" title="${escapeXml(item.title)}">${escapeXml(item.title)}</div>
            ${showSku ? `<div class="label-sku">کد: ${escapeXml(item.sku)}</div>` : ''}
            <div class="label-barcode-box">
              <svg class="barcode-svg" viewBox="0 0 100 24" preserveAspectRatio="none">
                <!-- simulated vector 1D barcode stripes -->
                <rect x="2" y="2" width="2" height="20" fill="#000"/>
                <rect x="6" y="2" width="1" height="20" fill="#000"/>
                <rect x="9" y="2" width="3" height="20" fill="#000"/>
                <rect x="14" y="2" width="2" height="20" fill="#000"/>
                <rect x="18" y="2" width="1" height="20" fill="#000"/>
                <rect x="21" y="2" width="3" height="20" fill="#000"/>
                <rect x="26" y="2" width="2" height="20" fill="#000"/>
                <rect x="30" y="2" width="1" height="20" fill="#000"/>
                <rect x="33" y="2" width="2" height="20" fill="#000"/>
                <rect x="37" y="2" width="3" height="20" fill="#000"/>
                <rect x="42" y="2" width="1" height="20" fill="#000"/>
                <rect x="45" y="2" width="2" height="20" fill="#000"/>
                <rect x="49" y="2" width="3" height="20" fill="#000"/>
                <rect x="54" y="2" width="1" height="20" fill="#000"/>
                <rect x="57" y="2" width="2" height="20" fill="#000"/>
                <rect x="61" y="2" width="3" height="20" fill="#000"/>
                <rect x="66" y="2" width="1" height="20" fill="#000"/>
                <rect x="69" y="2" width="2" height="20" fill="#000"/>
                <rect x="73" y="2" width="3" height="20" fill="#000"/>
                <rect x="78" y="2" width="1" height="20" fill="#000"/>
                <rect x="81" y="2" width="2" height="20" fill="#000"/>
                <rect x="85" y="2" width="3" height="20" fill="#000"/>
                <rect x="90" y="2" width="1" height="20" fill="#000"/>
                <rect x="93" y="2" width="2" height="20" fill="#000"/>
                <rect x="97" y="2" width="1" height="20" fill="#000"/>
              </svg>
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
      justify-content: flex-start;
      gap: 3mm 1.5%;
      width: 100%;
    }
    .barcode-label {
      border: 1px dashed #bbb;
      border-radius: 4px;
      padding: 2mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .label-title {
      font-size: 7.5pt;
      font-weight: 600;
      line-height: 1.15;
      max-height: 2.3em;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-sku {
      font-size: 6.5pt;
      color: #333;
      margin-top: 1px;
    }
    .label-barcode-box {
      width: 90%;
      margin: 1.5px 0;
      text-align: center;
    }
    .barcode-svg {
      width: 100%;
      height: 14px;
      display: block;
    }
    .label-barcode-digits {
      font-family: monospace;
      font-size: 6.5pt;
      letter-spacing: 1px;
      margin-top: 0.5px;
    }
    .label-price {
      font-size: 7.5pt;
      font-weight: bold;
      color: #000;
    }
    @media print {
      body {
        margin: 0;
      }
      .barcode-label {
        border-color: #ddd;
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

  toDto(e: PrintTemplateEntity): PrintTemplateResponseDto {
    return {
      id: e.id,
      docType: e.docType,
      docTypeLabel: PRINT_DOC_TYPE_LABELS[e.docType] ?? e.docType,
      paperSize: e.paperSize,
      paperSizeLabel: PRINT_PAPER_SIZE_LABELS[e.paperSize] ?? e.paperSize,
      title: e.title,
      isDefault: e.isDefault,
      showLogo: e.showLogo,
      logoUrl: e.logoUrl,
      columnsConfig: e.columnsConfig ?? [],
      options: e.options ?? {},
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
      updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : String(e.updatedAt),
    };
  }
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
