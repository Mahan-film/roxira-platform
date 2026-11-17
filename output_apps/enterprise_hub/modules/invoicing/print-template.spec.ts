import 'reflect-metadata';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrintDocType, PrintPaperSize } from './enums/print-template.enum';
import { PrintColumnConfig, PrintTemplateEntity } from './entities/print-template.entity';
import { PrintTemplateService, DEFAULT_COLUMNS_CONFIG } from './services/print-template.service';
import { PrintTemplateRepository } from './repositories/print-template.repository';
import { PrintTemplateController } from './controllers/print-template.controller';
import {
  CreatePrintTemplateDto,
  RenderBarcodeSheetDto,
  UpdatePrintTemplateDto,
} from './dto/print-template.dto';
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
      findByTitle: jest.fn(async (tId: string, docType: PrintDocType, paperSize: PrintPaperSize, title: string) => {
        return (
          templatesStore.find(
            (t) =>
              t.tenantId === tId &&
              t.docType === docType &&
              t.paperSize === paperSize &&
              t.title.toLowerCase() === title.toLowerCase(),
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
    it('returns none (no synthetic preset) when the tenant has no saved template', async () => {
      const template = await service.findDefault(tenantId, PrintDocType.SALES_INVOICE);
      expect(template).toBeNull();
      expect(await service.findDefault(tenantId, PrintDocType.SALES_INVOICE, PrintPaperSize.A5)).toBeNull();
    });

    it('offers builder-only preset values that are not a saved template', () => {
      const preset = service.getPreset(PrintDocType.SALES_INVOICE);
      expect(preset.id).toBe(0);
      expect(preset.columnsConfig.some((c: PrintColumnConfig) => c.key === 'totalPrice')).toBe(true);
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
      expect(template?.title).toBe('قالب سفارشی فاکتور فروش');
      expect(template?.paperSize).toBe(PrintPaperSize.A5);
      expect(template?.showLogo).toBe(false);
      expect(template?.columnsConfig).toHaveLength(3);
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

    it('allows same title across different docTypes and rejects duplicate (tenant, docType, title)', async () => {
      await service.create(tenantId, {
        title: 'قالب تست ۱',
        docType: PrintDocType.STOCK_DOCUMENT,
        paperSize: PrintPaperSize.A4,
      });

      // Same title with a different docType is allowed
      const salesTpl = await service.create(tenantId, {
        title: 'قالب تست ۱',
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.A4,
      });
      expect(salesTpl.id).toBeDefined();

      // Same title with a different paperSize is allowed
      const salesA5Tpl = await service.create(tenantId, {
        title: 'قالب تست ۱',
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.A5,
      });
      expect(salesA5Tpl.id).toBeDefined();

      // Same title with the same docType and paperSize is rejected
      await expect(
        service.create(tenantId, {
          title: 'قالب تست ۱',
          docType: PrintDocType.SALES_INVOICE,
          paperSize: PrintPaperSize.A4,
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
        service.create(tenantId, {
          title: '   ',
          docType: PrintDocType.SALES_INVOICE,
          paperSize: PrintPaperSize.A4,
        }),
      ).rejects.toThrow(BadRequestException);

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

    it('does not store a synthetic headerTitle when user sets none, preserving mapper title', async () => {
      const created = await service.create(tenantId, {
        title: 'قالب بدون عنوان سربرگ سفارشی',
        docType: PrintDocType.RECEIPT_PAYMENT_VOUCHER,
        paperSize: PrintPaperSize.A5,
      });

      expect(created.options?.headerTitle).toBeUndefined();

      const updated = await service.update(tenantId, created.id, {
        options: { headerTitle: 'رسید سفارشی' },
      });
      expect(updated.options?.headerTitle).toBe('رسید سفارشی');
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
            barcode: '6261234567897',
            title: 'شامپو پروتئینه',
            price: '500000', // 500,000 Rials
            count: 4,
          },
        ],
      });

      expect(html).toContain('width: 24%');
      expect(html).toContain('شامپو پروتئینه');
      expect(html).toContain('6261234567897');
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
      const res = generateBarcodeSvg('6260000000019'); // valid check digit
      expect(res.symbology).toBe('EAN-13');
      expect(res.encodedText).toBe('6260000000019');
      expect(res.svg).toContain('<svg class="barcode-svg"');
      expect(res.svg).toContain('<rect x="7"'); // EAN quiet zone
      const matches = res.svg.match(/<rect /g);
      expect(matches).toHaveLength(30);
    });

    it('does not rewrite a wrong EAN-13 check digit: falls back to Code128 with the stored value', () => {
      const res = generateBarcodeSvg('6260000000011'); // check digit should be 9
      expect(res.symbology).toBe('Code128');
      expect(res.encodedText).toBe('6260000000011');

      // Direct call throws rather than silently rewriting the stored value
      expect(() => encodeEan13Svg('6260000000011')).toThrow('Invalid EAN-13 check digit');
    });

    it('refuses non-ASCII characters in Code128 encoding to prevent corrupt barcodes', () => {
      expect(() => generateBarcodeSvg('کالای-۱')).toThrow(BadRequestException);
    });

    it('HTML-escapes tenant-supplied title, sku and barcode text in the label sheet', () => {
      const html = service.renderBarcodeLabelSheetHtml({
        columns: 4,
        items: [
          {
            sku: '"onerror=alert(1) x="',
            barcode: '<script>alert(2)</script>',
            title: '<script>alert(3)</script><img src=x onerror=alert(4)>',
            price: '1000',
            count: 1,
          },
        ],
      } as never);
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('"onerror=');
      expect(html).toContain('&lt;script&gt;');
    });

    it('formats barcode label consumer price from bigint-safe string rials input including 18-digit amounts', () => {
      const htmlStringPrice = service.renderBarcodeLabelSheetHtml({
        columns: 4,
        items: [{ sku: 'SKU-1', title: 'کالا ۱', price: '450000000', count: 1 }],
      } as never);
      expect(htmlStringPrice).toContain('۴۵۰٬۰۰۰٬۰۰۰ ریال');

      const htmlLargePrice = service.renderBarcodeLabelSheetHtml({
        columns: 4,
        items: [{ sku: 'SKU-2', title: 'کالا ۲', price: '9007199254740993', count: 1 }],
      } as never);
      expect(htmlLargePrice).toContain('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ ریال');
    });

    it('clamps item label counts and rejects non-positive counts against the 500-label cap', () => {
      // count < 1 throws BadRequestException
      expect(() =>
        service.renderBarcodeLabelSheetHtml({
          columns: 4,
          items: [{ sku: 'SKU-0', title: 'Zero count', count: 0 }],
        } as never),
      ).toThrow(BadRequestException);

      expect(() =>
        service.renderBarcodeLabelSheetHtml({
          columns: 4,
          items: [{ sku: 'SKU-NEG', title: 'Neg count', count: -5 }],
        } as never),
      ).toThrow(BadRequestException);

      // 6 items with count: 100 = 600 total labels > 500 cap -> throws BadRequestException
      expect(() =>
        service.renderBarcodeLabelSheetHtml({
          columns: 4,
          items: Array.from({ length: 6 }, (_, i) => ({
            sku: `SKU-${i}`,
            title: `Item ${i}`,
            count: 100,
          })),
        } as never),
      ).toThrow(BadRequestException);
    });
  });
});

describe('PrintTemplate validation & boolean coercion (Rule 26)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  it('transforms string "false" and "0" into boolean false without coercing to true', async () => {
    const createDto = await pipe.transform(
      {
        docType: PrintDocType.SALES_INVOICE,
        paperSize: PrintPaperSize.A4,
        title: 'قالب آزمایشی',
        isDefault: 'false',
        showLogo: '0',
      },
      { type: 'body', metatype: CreatePrintTemplateDto },
    );
    expect(createDto.isDefault).toBe(false);
    expect(createDto.showLogo).toBe(false);

    const updateDto = await pipe.transform(
      { isDefault: 'false', showLogo: false },
      { type: 'body', metatype: UpdatePrintTemplateDto },
    );
    expect(updateDto.isDefault).toBe(false);
    expect(updateDto.showLogo).toBe(false);

    const barcodeDto = await pipe.transform(
      {
        columns: 4,
        items: [{ sku: 'SKU-1', title: 'کالا ۱' }],
        showPrice: 'false',
        showSku: '0',
      },
      { type: 'body', metatype: RenderBarcodeSheetDto },
    );
    expect(barcodeDto.showPrice).toBe(false);
    expect(barcodeDto.showSku).toBe(false);
  });

  it('rejects invalid boolean strings', async () => {
    await expect(
      pipe.transform(
        {
          docType: PrintDocType.SALES_INVOICE,
          paperSize: PrintPaperSize.A4,
          title: 'قالب آزمایشی',
          isDefault: 'not-a-bool',
        },
        { type: 'body', metatype: CreatePrintTemplateDto },
      ),
    ).rejects.toBeDefined();
  });
});

describe('PrintTemplateController boolean coercion with supertest (Rule 26)', () => {
  let app: INestApplication;
  const mockService = {
    create: jest.fn().mockImplementation((_tId, dto) => Promise.resolve({ id: 1, ...dto })),
    renderBarcodeLabelSheetHtml: jest.fn().mockReturnValue('<html></html>'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrintTemplateController],
      providers: [
        {
          provide: PrintTemplateService,
          useValue: mockService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { sub: 'u1', tenantId: 't-test-1111' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockService.create.mockClear();
    mockService.renderBarcodeLabelSheetHtml.mockClear();
  });

  it('preserves isDefault=false and showLogo=false when sent as string "false" or "0"', async () => {
    await request(app.getHttpServer())
      .post('/enterprise-hub/invoicing/print-templates')
      .send({
        docType: 'sales_invoice',
        paperSize: 'A4',
        title: 'قالب آزمایشی سوپرتست',
        isDefault: 'false',
        showLogo: '0',
      })
      .expect(201);

    expect(mockService.create).toHaveBeenCalledWith(
      't-test-1111',
      expect.objectContaining({
        isDefault: false,
        showLogo: false,
      }),
    );
  });

  it('rejects invalid boolean in POST request with 400', async () => {
    await request(app.getHttpServer())
      .post('/enterprise-hub/invoicing/print-templates')
      .send({
        docType: 'sales_invoice',
        paperSize: 'A4',
        title: 'قالب آزمایشی',
        isDefault: 'invalid-value',
      })
      .expect(400);
  });

  it('preserves showPrice=false and showSku=false in barcode sheet request', async () => {
    await request(app.getHttpServer())
      .post('/enterprise-hub/invoicing/print-templates/barcode-sheet')
      .send({
        columns: 4,
        items: [{ sku: 'SKU-1', title: 'کالا ۱' }],
        showPrice: 'false',
        showSku: '0',
      })
      .expect(200);

    expect(mockService.renderBarcodeLabelSheetHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        showPrice: false,
        showSku: false,
      }),
    );
  });
});
