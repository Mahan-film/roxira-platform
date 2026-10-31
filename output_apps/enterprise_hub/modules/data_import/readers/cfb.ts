/** خواندن کمینهٔ فایل ترکیبی OLE2/CFB (برای XLS). همهٔ زنجیره‌ها با سقف گام در برابر حلقه محافظت می‌شوند. */

import { ReaderError } from './reader.types';

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FREE = 0xffffffff;
const END = 0xfffffffe;

export function isCfb(buffer: Buffer): boolean {
  return buffer.length >= 512 && buffer.subarray(0, 8).equals(SIGNATURE);
}

const BAD = 'فایل اکسل قدیمی (XLS) معتبر نیست یا آسیب‌دیده است.';

export function readCfbStream(buffer: Buffer, wanted: string[]): Buffer | null {
  if (!isCfb(buffer)) throw new ReaderError(BAD);
  const shift = buffer.readUInt16LE(30);
  const miniShift = buffer.readUInt16LE(32);
  if (shift !== 9 && shift !== 12) throw new ReaderError(BAD);
  const sectorSize = 1 << shift;
  const miniSize = 1 << miniShift;
  const sectorCount = Math.floor((buffer.length - 512) / sectorSize) + 1;
  const sectorOffset = (n: number): number => 512 + n * sectorSize;
  const sector = (n: number): Buffer => {
    if (n >= sectorCount) throw new ReaderError(BAD);
    return buffer.subarray(sectorOffset(n), sectorOffset(n) + sectorSize);
  };

  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDir = buffer.readUInt32LE(48);
  const miniCutoff = buffer.readUInt32LE(56);
  const firstMiniFat = buffer.readUInt32LE(60);
  const miniFatCount = buffer.readUInt32LE(64);
  const firstDifat = buffer.readUInt32LE(68);
  const difatCount = buffer.readUInt32LE(72);
  if (fatSectorCount > sectorCount) throw new ReaderError(BAD);

  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i += 1) {
    const s = buffer.readUInt32LE(76 + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let difat = firstDifat;
  for (let guard = 0; difat !== END && difat !== FREE && guard < difatCount && guard < 1024; guard += 1) {
    const d = sector(difat);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < fatSectorCount; i += 1) {
      const s = d.readUInt32LE(i * 4);
      if (s !== FREE) fatSectors.push(s);
    }
    difat = d.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const d = sector(s);
    for (let i = 0; i < sectorSize; i += 4) fat.push(d.readUInt32LE(i));
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    let cur = start;
    while (cur !== END && cur !== FREE) {
      if (out.length > table.length || cur >= table.length) throw new ReaderError(BAD);
      out.push(cur);
      cur = table[cur];
    }
    return out;
  };
  const readChain = (start: number): Buffer =>
    Buffer.concat(chain(start, fat).map((s) => sector(s)));

  const dir = readChain(firstDir);
  interface Entry { name: string; type: number; start: number; size: number }
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 64);
    if (nameLen < 2 || nameLen > 64) continue;
    entries.push({
      name: dir.subarray(off, off + nameLen - 2).toString('utf16le'),
      type: dir[off + 66],
      start: dir.readUInt32LE(off + 116),
      size: dir.readUInt32LE(off + 120),
    });
  }
  const target = entries.find((e) => e.type === 2 && wanted.includes(e.name));
  if (!target) return null;
  if (target.size > buffer.length * 4 + 1024) throw new ReaderError(BAD);

  if (target.size >= miniCutoff) {
    return readChain(target.start).subarray(0, target.size);
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new ReaderError(BAD);
  const miniStream = readChain(root.start);
  const miniFat: number[] = [];
  if (miniFatCount > 0) {
    const raw = readChain(firstMiniFat);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(raw.readUInt32LE(i));
  }
  const parts = chain(target.start, miniFat).map((m) =>
    miniStream.subarray(m * miniSize, m * miniSize + miniSize),
  );
  return Buffer.concat(parts).subarray(0, target.size);
}
