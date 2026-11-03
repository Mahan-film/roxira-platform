/** A cell is text, or `null` for SQL NULL / COPY `\N`. */
export type Cell = string | null;

export type ParseEvent =
  | { kind: 'table'; table: string; columns: string[] }
  | { kind: 'rows'; table: string; rows: Cell[][] }
  | { kind: 'note'; message: string };

/** Push parsers hold bounded state: they get bytes in pieces and return what completed in that piece. */
export interface PushParser {
  push(chunk: Uint8Array): Iterable<ParseEvent>;
  end(): Iterable<ParseEvent>;
}

/** Hostile-file counters every parser keeps; the runner turns them into notes for the review page. */
export interface ParseStats {
  truncatedCells: number;
  droppedColumns: number;
  raggedRows: number;
  formulaCells: number;
  skippedStatements: number;
}

export function emptyStats(): ParseStats {
  return { truncatedCells: 0, droppedColumns: 0, raggedRows: 0, formulaCells: 0, skippedStatements: 0 };
}

/** Errors whose message is safe and useful to show to the customer. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

export function statsNotes(stats: ParseStats, scope: string): string[] {
  const notes: string[] = [];
  if (stats.truncatedCells > 0) notes.push(`${scope}: ${stats.truncatedCells} سلول بیش از حد طولانی بریده شد.`);
  if (stats.droppedColumns > 0) notes.push(`${scope}: ستون‌های بیش از ۵۱۲ نادیده گرفته شد.`);
  if (stats.raggedRows > 0) notes.push(`${scope}: ${stats.raggedRows} ردیف تعداد ستون متفاوتی با سربرگ داشت.`);
  if (stats.formulaCells > 0) {
    notes.push(`${scope}: ${stats.formulaCells} سلول با نویسهٔ آغازین فرمول (= + - @) دیده شد؛ فقط به‌عنوان متن ذخیره می‌شود.`);
  }
  if (stats.skippedStatements > 0) notes.push(`${scope}: ${stats.skippedStatements} دستور غیرداده نادیده گرفته شد (هیچ دستوری اجرا نمی‌شود).`);
  return notes;
}

/** Table names are for people and for URLs: strip quoting, schema and control characters. */
export function cleanTableName(raw: string, fallback: string): string {
  const parts = raw
    .split('.')
    .map((part) => part.trim().replace(/^[`"[]+|[`"\]]+$/g, ''))
    .filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120).trim();
  return cleaned || fallback;
}

export function dedupeColumns(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((name, index) => {
    // eslint-disable-next-line no-control-regex
    let base = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || `column_${index + 1}`;
    base = base.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

/** A display label (file or sheet name): control characters out, length capped, dots kept. */
export function labelOf(raw: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || fallback;
}
