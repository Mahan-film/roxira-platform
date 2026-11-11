import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PrintDocType, PrintPaperSize } from './enums/print-template.enum';
import { PrintColumnConfig, PrintTemplateEntity } from './entities/print-template.entity';
import { PrintTemplateService, DEFAULT_COLUMNS_CONFIG } from './services/print-template.service';
import { PrintTemplateRepository } from './repositories/print-template.repository';
import { generateBarcodeSvg, encodeCode128Svg, encodeEan13Svg, isEan13 } from './services/barcode.helper';

describe('PrintTemplateService & Repository', () => {
  let service: PrintTemplateService;
  let mockRepo: jest.Mocked<Partial<PrintTemplateRepository>>;
  let templatesStore: PrintTemplateEntity[] = [];
  let nextId = 1;

  const tenantId = 't-test-1111';

  beforeEach(() => {
    templatesStore = [];
    nextId = 1;

    mockRepo = {
      saveWithDefault: jest.fn(async (tId: string, data: any, isDefault: boolean, existingId?: number) => {
        if (isDefault) {
          for (const t of templatesStore) {
            if (t.tenantId === tId && t.docType === data.docType && t.paperSize === data.paperSize && t.id !== existingId) {
              t.isDefault = false;
            }
          }
        }
        if (existingId) {
          const idx = templatesStore.findIndex((t) => t.tenantId === tId && t.id === existingId);
          if (idx === -1) throw new Error('Not found');
          templatesStore[idx] = { ...templatesStore[idx], ...data, isDefault, updatedAt: new Date() };
          return templatesStore[idx];
        }
        const entity: PrintTemplateEntity = {
          id: nextId++,
          tenantId: tId,
          docType: data.docType,
          paperSize: data.paperSize ?? PrintPaperSize.A4,
          title: data.title,
          isDefault,
          showLogo: data.showLogo ?? true,
          logoUrl: data.logoUrl ?? null,
          columnsConfig: data.columnsConfig ?? DEFAULT_COLUMNS_CONFIG[data.docType as PrintDocType],
          options: data.options ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        templatesStore.push(entity);
        return entity;
      }),
      list: jest.fn(async (tId: string, filter?: any) => {
        return templatesStore.filter((t) => {
          if (t.tenantId !== tId) return false;
          if (filter?.docType && t.docType !== filter.docType) return false;
          if (filter?.paperSize && t.paperSize !== filter.paperSize) return false;
          return true;
        });
      }),
      findById: jest.fn(async (tId: string, id: number) => {
        return templatesStore.find((t) => t.tenantId === tId && t.id === id) ?? null;
      }),
      findByTitle: jest.fn(async (tId: string, title: string) => {
        return (
          templatesStore.find(
            (t) => t.tenantId === tId && t.title.toLowerCase() === title.toLowerCase(),
          ) ?? null
        );
      }),
      findDefault: jest.fn(async (tId: string, docType: PrintDocType, paperSize?: PrintPaperSize) => {
        return (
          templatesStore.find(
            (t) =>
              t.tenantId === tId &&
              t.docType === docType &&
              (!paperSize || t.paperSize === paperSize) &&
              t.isDefault,
          ) ?? null
        );
      }),
      clearDefault: jest.fn(async (tId: string, docType: PrintDocType, paperSize: PrintPaperSize, excludeId?: number) => {
        for (const t of templatesStore) {
          if (t.tenantId === tId && t.docType === docType && t.paperSize === paperSize && t.id !== excludeId) {
            t.isDefault = false;
          }
        }
      }),
      delete: jest.fn(async (tId: string, id: number) => {
        const idx = templatesStore.findIndex((t) => t.tenantId === tId && t.id === id);
        if (idx === -1) return false;
        templatesStore.splice(idx, 1);
        return true;
      }),
    };

    service = new PrintTemplateService(mockRepo as PrintTemplateRepository);
  });

  describe('Default templates', () => {
    it('returns built-in default template when no custom template exists', async () => {
      const template = await service.findDefault(tenantId, PrintDocType.SALES_INVOICE);
      expect(template).toBeDefined();
      expect(template.docType).toBe(PrintDocType.SALES_INVOICE);
      expect(template.paperSize).toBe(PrintPaperSize.A4);
      expect(template.columnsConfig.length).toBeGreaterThan(0);
      expect(template.columnsConfig.some((c: PrintColumnConfig) => c.key === 'totalPrice')).toBe(true);
    });

    it('returns custom template when one is configured as default', async () => {
      await service.create(tenantId, {
        title: 'قالب سفارشی فاکتور فروش',
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.A5,
        isDefault: true,
        showLogo: false,
        columnsConfig: [
          { key: 'rowNumber', label: 'ردیف', visible: true, order: 1, widthPercent: 10 },
          { key: 'description', label: 'نام کالا', visible: true, order: 2, widthPercent: 50 },
          { key: 'totalPrice', label: 'مبلغ نهایی', visible: true, order: 3, widthPercent: 40 },
        ],
      });

      const template = await service.findDefault(tenantId, PrintDocType.SALES_INVOICE, PrintPaperSize.A5);
      expect(template.title).toBe('قالب سفارشی فاکتور فروش');
      expect(template.paperSize).toBe(PrintPaperSize.A5);
      expect(template.showLogo).toBe(false);
      expect(template.columnsConfig).toHaveLength(3);
    });
  });

  describe('CRUD operations', () => {
    it('creates, reads, updates and deletes a print template atomically', async () => {
      const created = await service.create(tenantId, {
        title: 'قالب حرارتی ۸۰ میلی‌متری',
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.THERMAL_80MM,
        showLogo: true,
        columnsConfig: [
          { key: 'description', label: 'شرح', visible: true, order: 1 },
          { key: 'quantity', label: 'تعداد', visible: true, order: 2 },
          { key: 'totalPrice', label: 'مبلغ', visible: true, order: 3 },
        ],
      });

      expect(created.id).toBeDefined();
      expect(created.paperSize).toBe(PrintPaperSize.THERMAL_80MM);

      const found = await service.findOne(tenantId, created.id);
      expect(found).not.toBeNull();
      expect(found.title).toBe('قالب حرارتی ۸۰ میلی‌متری');

      const updated = await service.update(tenantId, created.id, {
        title: 'قالب حرارتی بروز شده',
        showLogo: false,
      });
      expect(updated.title).toBe('قالب حرارتی بروز شده');
      expect(updated.showLogo).toBe(false);

      await service.remove(tenantId, created.id);
      await expect(service.findOne(tenantId, created.id)).rejects.toThrow();
    });

    it('rejects duplicate template titles for the same tenant', async () => {
      await service.create(tenantId, {
        title: 'قالب تست ۱',
        docType: PrintDocType.STOCK_DOCUMENT,
        paperSize: PrintPaperSize.A4,
      });

      await expect(
        service.create(tenantId, {
          title: 'قالب تست ۱',
          docType: PrintDocType.SALES_INVOICE,
          paperSize: PrintPaperSize.A5,
        }),
      ).rejects.toThrow('قبلاً برای این سازمان تعریف شده است');
    });

    it('rejects null or empty title and null columnsConfig on update', async () => {
      const created = await service.create(tenantId, {
        title: 'قالب آزمایشی اعتبارسنجی',
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.A4,
      });

      await expect(
        service.update(tenantId, created.id, { title: null as any }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update(tenantId, created.id, { title: '   ' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update(tenantId, created.id, { columnsConfig: null as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Barcode label sheets & Vector SVG encoding', () => {
    it('generates 4-column barcode label sheet HTML with genuine EAN-13 vector SVG', () => {
      const html = service.renderBarcodeLabelSheetHtml({
        columns: 4,
        showPrice: true,
        showSku: true,
        items: [
          {
            sku: 'SKU-001',
            barcode: '6261234567890',
            title: 'شامپو پروتئینه',
            price: '500000', // 500,000 Rials
            count: 4,
          },
        ],
      });

      expect(html).toContain('width: 24%');
      expect(html).toContain('شامپو پروتئینه');
      expect(html).toContain('6261234567890');
      expect(html).toContain('کد: SKU-001');
      expect(html).toContain('<svg class="barcode-svg"');
      expect(html).toContain('<rect x="');
      expect(html).toContain('۵۰۰٬۰۰۰ ریال');
    });

    it('generates 5-column barcode label sheet HTML with genuine Code128 vector SVG', () => {
      const html = service.renderBarcodeLabelSheetHtml({
        columns: 5,
        showPrice: false,
        showSku: true,
        items: [
          {
            sku: 'SKU-ABC',
            barcode: 'PROD-9988',
            title: 'روغن موتور',
            count: 5,
          },
        ],
      });

      expect(html).toContain('width: 19.2%');
      expect(html).toContain('روغن موتور');
      expect(html).toContain('PROD-9988');
      expect(html).toContain('<svg class="barcode-svg"');
      expect(html).toContain('<rect x="');
    });

    it('rejects requests with more than 500 total barcode labels to prevent DoS', () => {
      expect(() =>
        service.renderBarcodeLabelSheetHtml({
          columns: 4,
          items: [
            { sku: 'A', title: 'A', count: 300 },
            { sku: 'B', title: 'B', count: 250 },
          ],
        }),
      ).toThrow(BadRequestException);
    });

    it('encodes real Code128 vector SVG with valid quiet zone and checksum', () => {
      const res = generateBarcodeSvg('ROXIRA-POS-01');
      expect(res.symbology).toBe('Code128');
      expect(res.svg).toContain('<svg class="barcode-svg"');
      expect(res.svg).toContain('<rect x="10"'); // Quiet zone
      expect(res.svg).toContain('viewBox="0 0');
    });

    it('encodes real EAN-13 vector SVG with 30 bars and guard patterns', () => {
      const res = generateBarcodeSvg('6260000000011');
      expect(res.symbology).toBe('EAN-13');
      expect(res.svg).toContain('<svg class="barcode-svg"');
      expect(res.svg).toContain('<rect x="7"'); // EAN quiet zone
      const matches = res.svg.match(/<rect /g);
      expect(matches).toHaveLength(30);
    });
  });
});
