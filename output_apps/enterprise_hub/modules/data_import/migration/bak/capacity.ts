/**
 * Can THIS host restore THIS backup? The .bak must exist as a local file, the restored database is typically
 * 1-5x the backup size (compressed backups expand), and the NDJSON export adds roughly the data size again.
 * srv1 has about 16 GB free and also serves customers, so large jobs belong on a separate worker box
 * (docs/ops/BAK_PIPELINE.md). The check uses the exact file sizes from RESTORE FILELISTONLY.
 */
import { BackupFile } from './restore-plan';

const GiB = 1024 ** 3;

export interface HostCapacity {
  freeDiskBytes: number;
  freeMemBytes: number;
}

export interface CapacityPolicy {
  /** Disk that must stay free for the rest of the host (never fill srv1). */
  reserveDiskBytes: number;
  /** SQL Server's documented minimum is 2 GB; keep headroom for the host. */
  minMemBytes: number;
  /** Express edition: 10 GB per database (data files only). */
  editionDataLimitBytes: number | null;
}

export const SRV1_POLICY: CapacityPolicy = { reserveDiskBytes: 8 * GiB, minMemBytes: 3 * GiB, editionDataLimitBytes: 10 * GiB };

export type CapacityDecision = { ok: true; needDiskBytes: number } | { ok: false; code: 'disk' | 'memory' | 'edition-limit'; message: string };

const gib = (n: number) => `${(n / GiB).toFixed(1)} GiB`;

export function checkCapacity(bakBytes: number, files: BackupFile[], host: HostCapacity, policy: CapacityPolicy = SRV1_POLICY): CapacityDecision {
  const dataBytes = files.filter((f) => f.type === 'D').reduce((s, f) => s + f.sizeBytes, 0);
  const logBytes = files.filter((f) => f.type === 'L').reduce((s, f) => s + f.sizeBytes, 0);
  if (policy.editionDataLimitBytes !== null && dataBytes > policy.editionDataLimitBytes) {
    return {
      ok: false,
      code: 'edition-limit',
      message: `The database data is ${gib(dataBytes)}; the free Express edition restores at most ${gib(policy.editionDataLimitBytes)} per database. A licensed edition on a separate worker box is needed.`,
    };
  }
  // bak itself (already on disk before this check) is not counted again; data + log + export (~data) + 10 % slack.
  const need = Math.ceil((dataBytes + Math.min(logBytes, 2 * GiB) + dataBytes) * 1.1);
  if (host.freeDiskBytes - need < policy.reserveDiskBytes) {
    return {
      ok: false,
      code: 'disk',
      message: `Restoring needs about ${gib(need)} more disk (data ${gib(dataBytes)}, backup file ${gib(bakBytes)} already stored) and ${gib(policy.reserveDiskBytes)} must stay free; only ${gib(host.freeDiskBytes)} is free. Run it on the separate migration worker box.`,
    };
  }
  if (host.freeMemBytes < policy.minMemBytes) {
    return { ok: false, code: 'memory', message: `SQL Server needs at least ${gib(policy.minMemBytes)} free memory; ${gib(host.freeMemBytes)} is available.` };
  }
  return { ok: true, needDiskBytes: need };
}
