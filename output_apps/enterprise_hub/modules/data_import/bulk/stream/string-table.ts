import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { bulkTmpDir, xlsxStringsInMemory } from '../bulk.constants';

/**
 * XLSX shared strings. The first N live in memory; the rest are spooled to a temp file with an offset
 * index (12 bytes per string), so a workbook with tens of millions of strings still has bounded heap.
 */
export class StringTable {
  private readonly mem: string[] = [];
  private offsets = new Float64Array(1024);
  private lengths = new Uint32Array(1024);
  private spooled = 0;
  private fd = -1;
  private file = '';
  private writePos = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private readBuf = Buffer.allocUnsafe(64 * 1024);

  constructor(private readonly memoryLimit: number = xlsxStringsInMemory()) {}

  get size(): number {
    return this.mem.length + this.spooled;
  }

  add(value: string): void {
    if (this.mem.length < this.memoryLimit) {
      this.mem.push(value);
      return;
    }
    if (this.fd === -1) {
      this.file = path.join(bulkTmpDir(), `roxira-sst-${randomUUID()}`);
      this.fd = fs.openSync(this.file, 'w+');
    }
    if (this.spooled === this.offsets.length) {
      const grownOffsets = new Float64Array(this.offsets.length * 2);
      grownOffsets.set(this.offsets);
      this.offsets = grownOffsets;
      const grownLengths = new Uint32Array(this.lengths.length * 2);
      grownLengths.set(this.lengths);
      this.lengths = grownLengths;
    }
    const bytes = Buffer.from(value, 'utf8');
    this.offsets[this.spooled] = this.writePos + this.pendingBytes;
    this.lengths[this.spooled] = bytes.length;
    this.spooled += 1;
    this.pending.push(bytes);
    this.pendingBytes += bytes.length;
    if (this.pendingBytes >= 1024 * 1024) this.flush();
  }

  private flush(): void {
    if (this.pendingBytes === 0) return;
    const block = Buffer.concat(this.pending);
    fs.writeSync(this.fd, block, 0, block.length, this.writePos);
    this.writePos += block.length;
    this.pending = [];
    this.pendingBytes = 0;
  }

  get(index: number): string {
    if (!Number.isInteger(index) || index < 0) return '';
    if (index < this.mem.length) return this.mem[index];
    const k = index - this.mem.length;
    if (k >= this.spooled) return '';
    this.flush();
    const length = this.lengths[k];
    const buf = length <= this.readBuf.length ? this.readBuf : Buffer.allocUnsafe(length);
    fs.readSync(this.fd, buf, 0, length, this.offsets[k]);
    return buf.toString('utf8', 0, length);
  }

  close(): void {
    if (this.fd !== -1) {
      try {
        fs.closeSync(this.fd);
        fs.unlinkSync(this.file);
      } catch {
        /* best effort */
      }
      this.fd = -1;
    }
  }
}
