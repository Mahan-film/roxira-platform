/**
 * جمع‌آوری فایل‌های رهاشده روی صفحه، شامل پوشه‌ها (با پیمایش بازگشتی `webkitGetAsEntry`).
 * فقط فایل‌های معمولی برمی‌گردند؛ پوشهٔ خالی/لینک نادیده گرفته می‌شود و عمق و تعداد کران‌دار است.
 */

const MAX_DEPTH = 8;
const MAX_FILES = 500;

function readAll(entry: FileSystemEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    if (!entry.isDirectory) {
      resolve([]);
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    const next = (): void => {
      reader.readEntries((list) => {
        if (list.length === 0) {
          resolve(all);
          return;
        }
        all.push(...list);
        next();
      }, reject);
    };
    next();
  });
}

async function walk(entry: FileSystemEntry, depth: number, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) =>
      (entry as FileSystemFileEntry).file(ok, fail),
    );
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    for (const child of await readAll(entry)) {
      await walk(child, depth + 1, out);
    }
  }
}

export async function collectDroppedFiles(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) {
    return Array.from(transfer.files);
  }
  const out: File[] = [];
  for (const entry of entries) {
    await walk(entry, 0, out);
  }
  return out;
}
