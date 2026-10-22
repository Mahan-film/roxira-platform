import { imageMimeType, sniffFileKind } from './file-kind';

describe('sniffFileKind', () => {
  it('detects PDF, PNG, JPEG, WEBP and ZIP (XLSX) by magic bytes', () => {
    expect(sniffFileKind(Buffer.from('%PDF-1.4 ...'))).toBe('pdf');
    expect(
      sniffFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image');
    expect(sniffFileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(
      sniffFileKind(
        Buffer.concat([
          Buffer.from('RIFF', 'latin1'),
          Buffer.alloc(4),
          Buffer.from('WEBP', 'latin1'),
        ]),
      ),
    ).toBe('image');
    expect(
      sniffFileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])),
    ).toBe('xlsx');
  });

  it('trusts magic bytes over a misleading extension', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffFileKind(png, 'invoice.pdf', 'application/pdf')).toBe('image');
  });

  it('falls back to extension/mimetype for CSV', () => {
    expect(sniffFileKind(Buffer.from('a,b\n1,2'), 'leads.csv')).toBe('csv');
    expect(
      sniffFileKind(Buffer.from('a,b\n1,2'), 'data', 'text/csv'),
    ).toBe('csv');
  });

  it('returns unknown for unrecognised content', () => {
    expect(sniffFileKind(Buffer.from('hello'), 'notes.txt', 'text/plain')).toBe(
      'unknown',
    );
  });
});

describe('imageMimeType', () => {
  it('returns the exact mime type for supported images', () => {
    expect(
      imageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(imageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(imageMimeType(Buffer.from('not an image'))).toBeNull();
  });
});
