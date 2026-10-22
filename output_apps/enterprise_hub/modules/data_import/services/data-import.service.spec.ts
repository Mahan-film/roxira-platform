import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { deflateRawSync } from 'zlib';
import { DataImportService, UploadedFilePayload } from './data-import.service';
import { OpenRouterMappingService } from './openrouter-mapping.service';
import { OpenRouterVisionService } from './openrouter-vision.service';
import { UploadStoreService, StoredUpload } from './upload-store.service';
import { DataImportRepository } from '../repositories/data-import.repository';
import { CommitImportDto } from '../dto/commit-import.dto';

interface RepositoryMock {
  findLeadByEmail: jest.Mock;
  findLeadEmails: jest.Mock;
  createLeads: jest.Mock;
  createLead: jest.Mock;
}

interface OpenRouterMock {
  proposeMapping: jest.Mock;
}

interface VisionMock {
  extractTable: jest.Mock;
}

interface UploadStoreMock {
  save: jest.Mock;
  get: jest.Mock;
  remove: jest.Mock;
}

function makeService(): {
  service: DataImportService;
  repository: RepositoryMock;
  openRouter: OpenRouterMock;
  vision: VisionMock;
  uploadStore: UploadStoreMock;
} {
  const repository: RepositoryMock = {
    findLeadByEmail: jest.fn(),
    findLeadEmails: jest.fn().mockResolvedValue([]),
    createLeads: jest.fn().mockResolvedValue(0),
    createLead: jest.fn().mockResolvedValue(1),
  };
  const openRouter: OpenRouterMock = { proposeMapping: jest.fn() };
  const vision: VisionMock = { extractTable: jest.fn() };
  const uploadStore: UploadStoreMock = {
    save: jest.fn(),
    get: jest.fn(),
    remove: jest.fn(),
  };
  const service = new DataImportService(
    repository as unknown as DataImportRepository,
    openRouter as unknown as OpenRouterMappingService,
    uploadStore as unknown as UploadStoreService,
    vision as unknown as OpenRouterVisionService,
  );
  return { service, repository, openRouter, vision, uploadStore };
}

function csvFile(content: string, name = 'leads.csv'): UploadedFilePayload {
  return {
    originalname: name,
    mimetype: 'text/csv',
    size: content.length,
    buffer: Buffer.from(content, 'utf8'),
  };
}

/** ساخت کمینه آرشیو ZIP برای تست بارگذاری XLSX (بدون وابستگی خارجی). */
function makeZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

function xlsxFile(name = 'leads.xlsx'): UploadedFilePayload {
  const namespace =
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheet = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${namespace}"><sheetData>` +
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>name</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>email</t></is></c>' +
      '</row>' +
      '<row r="2">' +
      '<c r="A2" t="inlineStr"><is><t>Sara</t></is></c>' +
      '<c r="B2" t="inlineStr"><is><t>sara@x.com</t></is></c>' +
      '</row>' +
      '</sheetData></worksheet>',
    'utf8',
  );
  const buffer = makeZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }]);
  return {
    originalname: name,
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}

function storedUpload(
  headers: string[],
  rows: string[][],
): StoredUpload {
  return { headers, rows, expiresAt: Date.now() + 60_000 };
}

/** ساخت PDF متنی کمینه با دو ستون و یک ردیف داده. */
function makeTextPdf(content: string): Buffer {
  const data = Buffer.from(content, 'latin1');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${data.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  return Buffer.from(
    `%PDF-1.4\n${objects.join('')}trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`,
    'latin1',
  );
}

function pdfFile(): UploadedFilePayload {
  const content = [
    'BT /F1 12 Tf',
    '1 0 0 1 72 720 Tm (full name) Tj',
    '1 0 0 1 260 720 Tm (email) Tj',
    '1 0 0 1 72 700 Tm (Sara) Tj',
    '1 0 0 1 260 700 Tm (sara@x.com) Tj',
    'ET',
  ].join('\n');
  const buffer = makeTextPdf(content);
  return {
    originalname: 'leads.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
  };
}

function scannedPdfFile(): UploadedFilePayload {
  const buffer = makeTextPdf('BT /F1 12 Tf 1 0 0 1 72 720 Tm ET');
  return {
    originalname: 'scan.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
  };
}

/** تصویر PNG کمینه (فقط امضای بایتی کافی است؛ محتوا به مدل mock می‌رود). */
function imageFile(): UploadedFilePayload {
  const buffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
  ]);
  return {
    originalname: 'ledger.png',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
  };
}

describe('DataImportService.preview', () => {
  it('falls back to the deterministic synonym map when the LLM fails', async () => {
    const { service, openRouter, uploadStore } = makeService();
    openRouter.proposeMapping.mockRejectedValue(new Error('llm down'));

    const result = await service.preview(
      'tenant-1',
      csvFile('نام و نام خانوادگی,موبایل,ایمیل\nسارا,0912,s@x.com'),
    );

    expect(result.mappingSource).toBe('fallback');
    expect(result.mapping).toEqual({
      'نام و نام خانوادگی': 'fullName',
      موبایل: 'phone',
      ایمیل: 'email',
    });
    expect(result.headers).toEqual(['نام و نام خانوادگی', 'موبایل', 'ایمیل']);
    expect(result.sampleRows).toHaveLength(1);
    expect(uploadStore.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.objectContaining({
        headers: ['نام و نام خانوادگی', 'موبایل', 'ایمیل'],
      }),
    );
  });

  it('uses the LLM mapping when the model responds', async () => {
    const { service, openRouter } = makeService();
    openRouter.proposeMapping.mockResolvedValue({ name: 'fullName' });

    const result = await service.preview(
      'tenant-1',
      csvFile('name,email\nSara,s@x.com'),
    );

    expect(result.mappingSource).toBe('llm');
    expect(result.mapping).toEqual({ name: 'fullName' });
  });

  it('parses a valid XLSX upload in preview', async () => {
    const { service, openRouter, uploadStore } = makeService();
    openRouter.proposeMapping.mockRejectedValue(new Error('llm down'));

    const result = await service.preview('tenant-1', xlsxFile());

    expect(result.mappingSource).toBe('fallback');
    expect(result.headers).toEqual(['name', 'email']);
    expect(result.sampleRows).toEqual([['Sara', 'sara@x.com']]);
    expect(result.totalRows).toBe(1);
    expect(uploadStore.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.objectContaining({ headers: ['name', 'email'] }),
    );
  });

  it('rejects a malformed .xlsx upload', async () => {
    const { service } = makeService();
    await expect(
      service.preview('tenant-1', csvFile('a,b\n1,2', 'leads.xlsx')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detects XLSX by mimetype even without an .xlsx extension', async () => {
    const { service, openRouter } = makeService();
    openRouter.proposeMapping.mockResolvedValue({});

    const result = await service.preview('tenant-1', xlsxFile('export.dat'));

    expect(result.headers).toEqual(['name', 'email']);
  });

  it('parses a text PDF upload without calling the vision model', async () => {
    const { service, openRouter, vision } = makeService();
    openRouter.proposeMapping.mockResolvedValue({});

    const result = await service.preview('tenant-1', pdfFile());

    expect(result.headers).toEqual(['full name', 'email']);
    expect(result.sampleRows).toEqual([['Sara', 'sara@x.com']]);
    expect(vision.extractTable).not.toHaveBeenCalled();
  });

  it('rejects a scanned PDF with a Persian message', async () => {
    const { service } = makeService();
    await expect(
      service.preview('tenant-1', scannedPdfFile()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends an image to the vision model and uses its table', async () => {
    const { service, openRouter, vision } = makeService();
    openRouter.proposeMapping.mockResolvedValue({});
    vision.extractTable.mockResolvedValue({
      headers: ['name', 'email'],
      rows: [['Sara', 'sara@x.com']],
    });

    const result = await service.preview('tenant-1', imageFile());

    expect(vision.extractTable).toHaveBeenCalledWith([
      expect.objectContaining({ mimeType: 'image/png' }),
    ]);
    expect(result.headers).toEqual(['name', 'email']);
    expect(result.sampleRows).toEqual([['Sara', 'sara@x.com']]);
  });

  it('rejects an unknown file type', async () => {
    const { service } = makeService();
    const file: UploadedFilePayload = {
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: Buffer.from('junk'),
    };
    await expect(service.preview('tenant-1', file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a CSV larger than the env-configured spreadsheet limit', async () => {
    const { service } = makeService();
    process.env.IMPORT_MAX_SHEET_BYTES = '16';
    try {
      await expect(
        service.preview('tenant-1', csvFile('name,email\nSara,s@x.com', 'big.csv')),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      delete process.env.IMPORT_MAX_SHEET_BYTES;
    }
  });

  it('rejects a PDF larger than the env-configured document limit', async () => {
    const { service, vision } = makeService();
    process.env.IMPORT_MAX_DOC_BYTES = '10';
    try {
      await expect(service.preview('tenant-1', pdfFile())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(vision.extractTable).not.toHaveBeenCalled();
    } finally {
      delete process.env.IMPORT_MAX_DOC_BYTES;
    }
  });

  it('rejects a missing file', async () => {
    const { service } = makeService();
    await expect(service.preview('tenant-1', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects files with more than the configured row limit', async () => {
    const { service } = makeService();
    const rows = Array.from({ length: 20001 }, () => 'x,y').join('\n');
    await expect(
      service.preview('tenant-1', csvFile(`name,email\n${rows}`)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DataImportService.commit', () => {
  const mapping = { name: 'fullName', email: 'email' };

  it('only reads the upload inside the caller tenant', async () => {
    const { service, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(null);

    await expect(
      service.commit('tenant-b', {
        uploadId: '11111111-1111-4111-8111-111111111111',
        mapping,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(uploadStore.get).toHaveBeenCalledWith(
      'tenant-b',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('imports through the repository with the caller tenant', async () => {
    const { service, repository, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(['name', 'email'], [['Sara', 'sara@x.com']]),
    );
    repository.createLeads.mockResolvedValue(1);

    const result = await service.commit('tenant-a', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      mapping,
    } as CommitImportDto);

    expect(repository.findLeadEmails).toHaveBeenCalledWith('tenant-a', [
      'sara@x.com',
    ]);
    expect(repository.createLeads).toHaveBeenCalledWith(
      'tenant-a',
      expect.arrayContaining([
        expect.objectContaining({ fullName: 'Sara', email: 'sara@x.com' }),
      ]),
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicates by (tenant, email) including in-file repeats', async () => {
    const { service, repository, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(
        ['name', 'email'],
        [
          ['Ali Ahmadi', 'dup@x.com'],
          ['Bahar Karimi', 'dup@x.com'],
          ['Cyrus Rad', 'existing@x.com'],
        ],
      ),
    );
    repository.findLeadEmails.mockResolvedValue(['existing@x.com']);
    repository.createLeads.mockResolvedValue(1);

    const result = await service.commit('tenant-a', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      mapping,
    } as CommitImportDto);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('reports validation errors per row without aborting the import', async () => {
    const { service, repository, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(
        ['name', 'email'],
        [
          ['', 'not-an-email'],
          ['Valid Name', 'ok@x.com'],
        ],
      ),
    );
    repository.createLeads.mockResolvedValue(1);

    const result = await service.commit('tenant-a', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      mapping,
    } as CommitImportDto);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].reason).toContain('email');
  });

  it('clears the upload after a successful commit', async () => {
    const { service, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(['name', 'email'], [['Sara', 'sara@x.com']]),
    );

    await service.commit('tenant-a', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      mapping,
    } as CommitImportDto);

    expect(uploadStore.remove).toHaveBeenCalledWith(
      'tenant-a',
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
