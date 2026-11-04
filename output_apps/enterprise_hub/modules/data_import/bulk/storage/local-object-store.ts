import { createHash } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { CompletedPart, ObjectStore, PartInfo } from './object-store';

/**
 * Filesystem object store for developer machines, tests and the benchmark. Not for production: there
 * the API would carry the bytes. Layout: `<root>/<key>` for finished objects, `<root>/.multipart/<id>/<n>`
 * for parts.
 */
export class LocalObjectStore implements ObjectStore {
  readonly driver = 'local' as const;
  readonly direct = false;

  constructor(private readonly root: string) {}

  private objectPath(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid key');
    return resolved;
  }

  private partsDir(uploadId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error('Invalid upload id');
    return path.join(this.root, '.multipart', uploadId);
  }

  async createMultipart(key: string): Promise<{ uploadId: string }> {
    const uploadId = require('crypto').randomUUID() as string;
    await fsp.mkdir(this.partsDir(uploadId), { recursive: true });
    await fsp.writeFile(path.join(this.partsDir(uploadId), 'key'), key);
    return { uploadId };
  }

  async presignPart(): Promise<string> {
    throw new Error('The local store has no presigned URLs');
  }

  async listParts(_key: string, uploadId: string): Promise<PartInfo[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.partsDir(uploadId));
    } catch {
      return [];
    }
    const parts: PartInfo[] = [];
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      const stat = await fsp.stat(path.join(this.partsDir(uploadId), name));
      parts.push({ partNumber: Number(name), size: stat.size, etag: `"${name}-${stat.size}"` });
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async putPart(_key: string, uploadId: string, partNumber: number, body: Readable) {
    const target = path.join(this.partsDir(uploadId), String(partNumber));
    const temp = `${target}.tmp`;
    await pipeline(body, fs.createWriteStream(temp));
    await fsp.rename(temp, target);
    const stat = await fsp.stat(target);
    return { etag: `"${partNumber}-${stat.size}"`, size: stat.size };
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<{ size: number }> {
    const target = this.objectPath(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const out = fs.createWriteStream(target);
    for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
      await new Promise<void>((resolve, reject) => {
        const input = fs.createReadStream(path.join(this.partsDir(uploadId), String(part.partNumber)));
        input.on('error', reject);
        input.on('end', resolve);
        input.pipe(out, { end: false });
      });
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    await fsp.rm(this.partsDir(uploadId), { recursive: true, force: true });
    return { size: (await fsp.stat(target)).size };
  }

  async abortMultipart(_key: string, uploadId: string): Promise<void> {
    await fsp.rm(this.partsDir(uploadId), { recursive: true, force: true });
  }

  async read(key: string, start = 0): Promise<Readable> {
    return fs.createReadStream(this.objectPath(key), { start, highWaterMark: 1024 * 1024 });
  }

  async size(key: string): Promise<number> {
    return (await fsp.stat(this.objectPath(key))).size;
  }

  async remove(key: string): Promise<void> {
    await fsp.rm(this.objectPath(key), { force: true });
  }

  async putFile(key: string, localPath: string): Promise<void> {
    const target = this.objectPath(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.link(localPath, target);
    } catch {
      await fsp.copyFile(localPath, target);
    }
  }
}

/** Unused but handy for tests that want a stable digest of a local object. */
export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}
