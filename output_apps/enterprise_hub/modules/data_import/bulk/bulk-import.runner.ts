import { Inject, Injectable, Logger } from '@nestjs/common';
import { Readable, Transform } from 'stream';
import { maxChunkedFileBytes } from '../constants/package-import.constants';
import { analyseTables } from '../analysis/package-analysis';
import { enrichTables } from '../analysis/enrich';
import { InMemoryTableReader } from '../parsers/package-source.types';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { MappingMemoryService } from '../services/mapping-memory.service';
import { Optional } from '@nestjs/common';
import { BulkImportRepository } from './bulk-import.repository';
import { BulkJob, BulkTableInfo } from './bulk-import.types';
import { progressIntervalMs, STAGING_BATCH_CHARS, STAGING_BATCH_ROWS } from './bulk.constants';
import { OBJECT_STORE, ObjectStore } from './storage/object-store';
import { parseSource } from './stream/source-parser';
import { Cell, ImportFileError } from './stream/types';

export type RunOutcome = 'ready' | 'paused' | 'cancelled' | 'skipped';

const MAX_NOTES = 200;

/**
 * Turns an uploaded object into staged rows. Reads the object as a stream, parses it incrementally and
 * writes batches of at most ~5 000 rows; the heap never holds more than one batch plus one input chunk,
 * whatever the file size. Progress and the resume checkpoint are committed together with each batch. Pause
 * and cancel are honoured at the next batch boundary (about a second).
 */
@Injectable()
export class BulkImportRunner {
  private readonly logger = new Logger(BulkImportRunner.name);

  constructor(
    private readonly repo: BulkImportRepository,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Optional() private readonly registry?: EntityRegistryService,
    @Optional() private readonly memory?: MappingMemoryService,
  ) {}

  async run(tenantId: string, jobId: string, options: { finalAttempt?: boolean } = {}): Promise<RunOutcome> {
    const job = await this.repo.getJob(tenantId, jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return 'skipped';
    await this.repo.update(tenantId, jobId, {
      status: 'running',
      attempts: job.attempts + 1,
      startedAt: job.startedAt ?? new Date(),
      error: null,
    });

    try {
      return await this.stage(tenantId, job);
    } catch (error) {
      const known = error instanceof ImportFileError;
      const message = known ? (error as Error).message : 'خطای موقت هنگام خواندن فایل رخ داد؛ دوباره تلاش کنید.';
      if (!known) this.logger.error(`[BULK-IMPORT] job ${jobId} failed: ${(error as Error).message}`);
      if (known || options.finalAttempt) {
        await this.repo.update(tenantId, jobId, { status: 'failed', error: message, finishedAt: new Date() });
        if (known) return 'skipped'; // reported through the job row, not retried
      }
      throw error;
    }
  }

  private async stage(tenantId: string, job: BulkJob): Promise<RunOutcome> {
    const store = this.store;
    const size = job.sizeBytes;
    let opens = 0;
    let bytes = 0;
    const open = async (): Promise<Readable> => {
      opens += 1;
      const source = await store.read(job.objectKey);
      if (opens === 1) return source; // the type sniff reads only a little; do not count it
      bytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          cb(null, chunk);
        },
      });
      source.on('error', (error) => counter.destroy(error));
      return source.pipe(counter);
    };

    const tables = new Map<string, BulkTableInfo>(job.tables.map((t) => [t.name, { ...t }]));
    const resumeFrom: Record<string, number> = { ...(job.checkpoint.rows ?? {}) };
    const seen: Record<string, number> = {};
    const staged: Record<string, number> = { ...resumeFrom };
    const notes = new Set<string>(job.notes);
    let rowsStaged = job.rowsStaged;

    let batchTable: BulkTableInfo | null = null;
    let batchFirst = 0;
    let batch: Cell[][] = [];
    let batchChars = 0;
    let lastPoll = Date.now();

    const progress = () => ({
      bytesRead: Math.min(size, bytes),
      rowsStaged,
      tables: [...tables.values()].map((t) => ({ ...t })),
      checkpoint: { rows: { ...staged } },
    });

    // One write stays in flight while the parser works on the next batch (two batches in memory at most).
    let writing: Promise<void> = Promise.resolve();

    const flush = async (): Promise<void> => {
      if (!batchTable || batch.length === 0) {
        batch = [];
        batchChars = 0;
        return;
      }
      const info = batchTable;
      const rows = batch;
      const first = batchFirst;
      rowsStaged += rows.length;
      info.rows += rows.length;
      staged[info.name] = (staged[info.name] ?? 0) + rows.length;
      const snapshot = progress();
      batch = [];
      batchChars = 0;
      await writing;
      writing = this.repo.appendBatch(tenantId, job.id, info.idx, first, rows, snapshot);
      writing.catch(() => undefined); // the error is raised by the next `await writing`
    };

    const controlRequested = async (): Promise<RunOutcome | null> => {
      const status = await this.repo.status(tenantId, job.id);
      if (status === 'pausing') {
        await flush();
        await writing;
        await this.repo.update(tenantId, job.id, { status: 'paused', ...progress() });
        return 'paused';
      }
      if (status === 'cancelling') {
        batch = [];
        await writing;
        await this.repo.update(tenantId, job.id, { status: 'cancelled', finishedAt: new Date() });
        return 'cancelled';
      }
      return null;
    };

    const stream = parseSource({
      fileName: job.fileName,
      size,
      open,
      legacyMaxBytes: maxChunkedFileBytes(),
    });
    try {
      for await (const event of stream) {
        if (event.kind === 'note') {
          if (notes.size < MAX_NOTES) notes.add(event.message);
        } else if (event.kind === 'table') {
          await flush();
          if (!tables.has(event.table)) {
            tables.set(event.table, { idx: tables.size, name: event.table, columns: event.columns, rows: 0 });
          }
          seen[event.table] = 0;
        } else {
          const info = tables.get(event.table);
          if (!info) continue;
          if (batchTable && batchTable !== info) await flush();
          for (const row of event.rows) {
            const rowNo = (seen[info.name] = (seen[info.name] ?? 0) + 1);
            if (rowNo <= (resumeFrom[info.name] ?? 0)) continue; // already staged by an earlier run
            if (batch.length === 0) {
              batchTable = info;
              batchFirst = rowNo;
            }
            batch.push(row);
            for (let k = 0; k < row.length; k += 1) batchChars += (row[k]?.length ?? 4) + 3;
            if (batch.length >= STAGING_BATCH_ROWS || batchChars >= STAGING_BATCH_CHARS) {
              await flush();
              if (Date.now() - lastPoll >= progressIntervalMs()) {
                lastPoll = Date.now();
                const outcome = await controlRequested();
                if (outcome) return outcome;
              }
            }
          }
        }
        if (Date.now() - lastPoll >= progressIntervalMs()) {
          lastPoll = Date.now();
          const outcome = await controlRequested();
          if (outcome) return outcome;
        }
      }
      await flush();
      await writing;
    } finally {
      await writing.catch(() => undefined);
      await stream.return(undefined).catch(() => undefined);
    }

    const review = await this.suggest(tenantId, job, [...tables.values()]);
    await this.repo.update(tenantId, job.id, {
      status: 'ready',
      bytesRead: size,
      rowsStaged,
      tables: [...tables.values()],
      checkpoint: { rows: staged },
      notes: [...notes],
      review,
      finishedAt: new Date(),
    });
    return 'ready';
  }

  /** Suggested entity and column mapping per table, from the header and the first rows (never the whole table). */
  private async suggest(tenantId: string, job: BulkJob, tables: BulkTableInfo[]): Promise<unknown> {
    if (!this.registry) return null;
    try {
      const readers: InMemoryTableReader[] = [];
      for (const table of tables) {
        const rows = await this.repo.readRows(tenantId, job.id, table.idx, 0, 200);
        readers.push(
          new InMemoryTableReader(
            table.name,
            table.columns,
            rows.map((r) => table.columns.map((_c, i) => r.cells[i] ?? '')),
          ),
        );
      }
      const adapters = this.registry.all();
      const analyses = analyseTables(readers, adapters);
      const enriched = await enrichTables(readers, analyses, adapters, this.memory ? (sig) => this.memory!.recall(tenantId, sig) : undefined);
      return enriched.map((analysis) => ({
        ...analysis,
        rowCount: tables.find((t) => t.name === analysis.name)?.rows ?? analysis.rowCount,
      }));
    } catch (error) {
      this.logger.warn(`[BULK-IMPORT] suggestions failed for ${job.id}: ${(error as Error).message}`);
      return null;
    }
  }
}
