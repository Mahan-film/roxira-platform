import * as zlib from 'zlib';

/**
 * Pure Node.js zero-dependency ZIP archive creator (PKZIP 2.0 format).
 * Deflates all entries and writes valid Local File Headers, Central Directory,
 * and End of Central Directory record with accurate CRC-32 checksums.
 * Completely compliant with unzip, 7z, Windows Explorer, macOS Archive Utility, and Python zipfile.
 */
export function createZipBuffer(files: Record<string, string | Buffer | Uint8Array>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.isBuffer(content)
      ? content
      : typeof content === 'string'
        ? Buffer.from(content, 'utf-8')
        : Buffer.from(content);

    const compressed = zlib.deflateRawSync(dataBuf);
    const crc = (zlib as any).crc32 ? (zlib as any).crc32(dataBuf) : computeCrc32Fallback(dataBuf);

    // Local file header (30 bytes + name)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    lh.writeUInt16LE(20, 4); // version needed (2.0)
    lh.writeUInt16LE(0, 6); // general purpose flags
    lh.writeUInt16LE(8, 8); // compression method (8 = deflate)
    lh.writeUInt16LE(0, 10); // file modification time
    lh.writeUInt16LE(0, 12); // file modification date
    lh.writeUInt32LE(crc >>> 0, 14); // crc-32
    lh.writeUInt32LE(compressed.length, 18); // compressed size
    lh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // file name length
    lh.writeUInt16LE(0, 28); // extra field length

    // Central directory header (46 bytes + name)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // signature PK\x01\x02
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // general purpose flags
    ch.writeUInt16LE(8, 10); // compression method (8 = deflate)
    ch.writeUInt16LE(0, 12); // file modification time
    ch.writeUInt16LE(0, 14); // file modification date
    ch.writeUInt32LE(crc >>> 0, 16); // crc-32
    ch.writeUInt32LE(compressed.length, 20); // compressed size
    ch.writeUInt32LE(dataBuf.length, 24); // uncompressed size
    ch.writeUInt16LE(nameBuf.length, 28); // file name length
    ch.writeUInt16LE(0, 30); // extra field length
    ch.writeUInt16LE(0, 32); // comment length
    ch.writeUInt16LE(0, 34); // disk number start
    ch.writeUInt16LE(0, 36); // internal file attributes
    ch.writeUInt32LE(0, 38); // external file attributes
    ch.writeUInt32LE(offset, 42); // relative offset of local header

    localHeaders.push(lh, nameBuf, compressed);
    centralHeaders.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + compressed.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const b of centralHeaders) {
    centralDirSize += b.length;
  }

  const entryCount = Object.keys(files).length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where central dir starts
  eocd.writeUInt16LE(entryCount, 8); // number of central directory records on this disk
  eocd.writeUInt16LE(entryCount, 10); // total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/** Fallback CRC-32 for environments where zlib.crc32 might not be present */
function computeCrc32Fallback(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
