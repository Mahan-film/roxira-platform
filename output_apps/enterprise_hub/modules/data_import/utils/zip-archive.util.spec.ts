import { createZipBuffer } from './zip-archive.util';
import * as zlib from 'zlib';

describe('createZipBuffer (Zero-dependency ZIP archive generator)', () => {
  it('creates a valid ZIP buffer with multiple text and json files', () => {
    const files = {
      'customers.csv': 'id,name,role\n1,شرکت آلفا,customer\n2,شرکت بتا,supplier',
      'invoices.csv': 'id,number,amount\nINV-001,1001,15000000',
      'metadata.json': JSON.stringify({ version: '1.0', tenantId: 'tenant-123' }),
    };

    const zipBuffer = createZipBuffer(files);

    expect(zipBuffer).toBeInstanceOf(Buffer);
    expect(zipBuffer.length).toBeGreaterThan(100);

    // Verify PK signature at byte 0: 0x50, 0x4b, 0x03, 0x04 (PK\x03\x04)
    expect(zipBuffer[0]).toBe(0x50);
    expect(zipBuffer[1]).toBe(0x4b);
    expect(zipBuffer[2]).toBe(0x03);
    expect(zipBuffer[3]).toBe(0x04);

    // Verify filenames exist in zip
    const zipString = zipBuffer.toString('utf-8');
    expect(zipString).toContain('customers.csv');
    expect(zipString).toContain('invoices.csv');
    expect(zipString).toContain('metadata.json');
  });

  it('handles empty and binary buffers cleanly', () => {
    const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const zipBuffer = createZipBuffer({
      'empty.txt': '',
      'bin.dat': binary,
    });

    expect(zipBuffer.length).toBeGreaterThan(0);
    expect(zipBuffer[0]).toBe(0x50);
    expect(zipBuffer[1]).toBe(0x4b);
  });
});
