/**
 * اجرای دستورهای دامپ SQL در یک worker thread جداگانه.
 *
 * دستورها پیش‌تر در رشتهٔ اصلی allowlist شده‌اند؛ این worker باز هم با timeout،
 * سقف heap و سقف اندازهٔ دیتابیس (`PRAGMA max_page_count`) اجرا می‌شود تا دامپ
 * بدخواه نتواند پردازهٔ API را قفل کند. خروجی، فایل باینری SQLite است که
 * رشتهٔ اصلی فقط می‌خواند و هیچ SQL مشتری را اجرا نمی‌کند.
 *
 * کد worker به‌صورت رشتهٔ JS داده می‌شود (`eval: true`) تا هم در `nest build` و
 * هم در jest بدون وابستگی به مسیر فایل کامپایل‌شده کار کند.
 */

import { Worker } from "worker_threads";
import * as path from "path";
import { PACKAGE_MAX_UNCOMPRESSED_BYTES } from "../constants/package-import.constants";

/** خطای اجرای worker با دلیل مشخص. */
export class SqlWorkerError extends Error {
  constructor(readonly reason: "timeout" | "oom" | "too_large" | "sql_error") {
    super(reason);
  }
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const initSqlJs = require(workerData.sqlJsEntry);
(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => require('path').join(workerData.distDir, file),
  });
  const db = new SQL.Database();
  try {
    db.run('PRAGMA max_page_count = ' + workerData.maxPages);
    for (const statement of workerData.statements) {
      db.run(statement);
    }
    const bytes = db.export();
    parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (error) {
    const message = String(error && error.message || error);
    parentPort.postMessage({ ok: false, full: /database or disk is full/i.test(message) });
  } finally {
    db.close();
  }
})();
`;

/** سقف زمان اجرا (میلی‌ثانیه) از `IMPORT_SQL_TIMEOUT_MS`، پیش‌فرض ۳۰ ثانیه. */
export function sqlWorkerTimeoutMs(): number {
  const value = Number.parseInt(process.env.IMPORT_SQL_TIMEOUT_MS ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : 30_000;
}

/** اجرای دستورها در worker و بازگرداندن بایت‌های دیتابیس SQLite. */
export function runStatementsInWorker(statements: string[]): Promise<Buffer> {
  const sqlJsEntry = require.resolve("sql.js");
  const distDir = path.dirname(sqlJsEntry);
  const pageSize = 4096;
  const maxPages = Math.floor(PACKAGE_MAX_UNCOMPRESSED_BYTES / pageSize);

  return new Promise<Buffer>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { sqlJsEntry, distDir, statements, maxPages },
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 64,
      },
    });
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new SqlWorkerError("timeout"))),
      sqlWorkerTimeoutMs(),
    );
    worker.once(
      "message",
      (message: { ok: boolean; bytes?: Uint8Array; full?: boolean }) => {
        finish(() => {
          if (message.ok && message.bytes) {
            resolve(Buffer.from(message.bytes));
          } else {
            reject(
              new SqlWorkerError(message.full ? "too_large" : "sql_error"),
            );
          }
        });
      },
    );
    worker.once("error", (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new SqlWorkerError(
            error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "oom" : "sql_error",
          ),
        ),
      );
    });
    worker.once("exit", () => {
      finish(() => reject(new SqlWorkerError("sql_error")));
    });
  });
}
