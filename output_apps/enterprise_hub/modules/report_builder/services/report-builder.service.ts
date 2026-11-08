import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../access/services/audit.service';
import { fromDb } from '../../accounting/money';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { writePdf } from '../../accounting/reports/pdf-writer';
import { writeXlsx } from '../../accounting/reports/xlsx-writer';
import {
  AGGREGATE_ALIAS_PATTERN,
  AggregateFunc,
  ColumnType,
  DEFAULT_REPORT_LIMIT,
  MAX_IN_VALUES,
  MAX_REPORT_LIMIT,
  WHITELISTED_DATASETS,
  WhitelistedColumn,
  WhitelistedDataset,
} from '../constants/report-builder.constants';
import {
  ExecuteReportQueryDto,
  ExportReportDto,
  ReportFilterDto,
  ReportQueryResultView,
  ReportTemplateView,
  SaveReportTemplateDto,
} from '../dto/report-builder.dto';
import { ReportBuilderRepository } from '../repositories/report-builder.repository';

const IN_CAST: Record<Exclude<ColumnType, 'string'>, string> = {
  number: 'numeric',
  money: 'numeric',
  date: 'date',
  boolean: 'boolean',
};

const AGGREGATE_LABEL_FA: Record<AggregateFunc, string> = {
  sum: 'جمع',
  count: 'تعداد',
  avg: 'میانگین',
  min: 'کمترین',
  max: 'بیشترین',
};

export interface CompiledQuery {
  sql: string;
  countSql: string;
  /** Parameters of the WHERE clause (used by the count query). */
  params: unknown[];
  /** `params` followed by the bound LIMIT and OFFSET (used by the row query). */
  queryParams: unknown[];
  selectedColumns: Array<{ id: string; labelFa: string; type: string }>;
}

@Injectable()
export class ReportBuilderService {
  private readonly logger = new Logger(ReportBuilderService.name);

  constructor(
    private readonly repo: ReportBuilderRepository,
    private readonly audit: AuditService,
  ) {}

  /** Available datasets and their schema for UI discovery. */
  getAvailableDatasets(): Array<{
    id: string;
    labelFa: string;
    descriptionFa: string;
    columns: Array<{ id: string; labelFa: string; type: string; aggregatable: string[] }>;
  }> {
    return Object.values(WHITELISTED_DATASETS).map((ds) => ({
      id: ds.id,
      labelFa: ds.labelFa,
      descriptionFa: ds.descriptionFa,
      columns: Object.values(ds.columns).map((c) => ({
        id: c.id,
        labelFa: c.labelFa,
        type: c.type,
        aggregatable: c.aggregatable ?? [],
      })),
    }));
  }

  /**
   * Compiles and executes a custom report query with:
   *   1. Whitelisted column and operator enforcement
   *   2. Parameterized SQL injection prevention
   *   3. 5-second statement timeout
   *   4. Read-only transaction enforcement
   *   5. Tenant FORCE RLS protection
   */
  async executeQuery(
    tenantId: string,
    dto: ExecuteReportQueryDto,
  ): Promise<ReportQueryResultView> {
    const t0 = Date.now();
    const compiled = this.compileQuery(dto);

    try {
      const [rows, countRows] = await Promise.all([
        this.repo.executeReadOnlyQuery<Record<string, unknown>>(
          tenantId,
          compiled.sql,
          compiled.queryParams,
        ),
        this.repo.executeReadOnlyQuery<{ total: string }>(
          tenantId,
          compiled.countSql,
          compiled.params,
        ),
      ]);

      const totalRows = Number(countRows[0]?.total ?? rows.length);
      const durationMs = Date.now() - t0;

      const formattedRows = rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const col of compiled.selectedColumns) {
          const val = r[col.id];
          if (col.type === 'money' && val != null) {
            out[col.id] = String(val);
          } else if (col.type === 'date' && val instanceof Date) {
            out[col.id] = val.toISOString().slice(0, 10);
          } else {
            out[col.id] = val;
          }
        }
        // include any aggregate aliases
        for (const [k, v] of Object.entries(r)) {
          if (!(k in out)) {
            out[k] = v;
          }
        }
        return out;
      });

      return {
        dataset: dto.dataset,
        columns: compiled.selectedColumns,
        rows: formattedRows,
        totalRows,
        durationMs,
      };
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('statement_timeout') || msg.includes('canceling statement due to statement timeout')) {
        throw new BadRequestException('زمان اجرای گزارش از سقف مجاز (۵ ثانیه) بیشتر شد. لطفاً بازه یا فیلترهای محدودتری انتخاب کنید.');
      }
      const code = (err as { code?: string }).code ?? '';
      // 22xxx data exception, 42803 grouping error, 42883/42846 operator or cast mismatch: a bad request, not a crash.
      if (/^22/.test(code) || ['42803', '42883', '42846'].includes(code)) {
        throw new BadRequestException('مقدار یا ترکیب ستون‌ها و فیلترهای گزارش با نوع داده سازگار نیست.');
      }
      this.logger.error(`Report execution error: ${msg}`);
      throw err;
    }
  }

  /**
   * Compiles the parameterized SQL query. The only text that reaches the SQL string is taken from the
   * whitelist (`sqlExpr`, `fromSql`, `tenantExpr`, `defaultOrderBy`), from literal operator and
   * aggregate keywords chosen by `switch`/`includes` against whitelisted values, or from a column
   * id / aggregate alias that matched a strict identifier pattern. Every value (filters, LIMIT,
   * OFFSET) is a bound parameter.
   */
  compileQuery(dto: ExecuteReportQueryDto): CompiledQuery {
    const dataset = WHITELISTED_DATASETS[dto.dataset];
    if (!dataset) {
      throw new BadRequestException(`مجموعه دادهٔ «${dto.dataset}» معتبر نیست.`);
    }

    const groupIds = dto.groupBy ?? [];
    const aggregates = dto.aggregates ?? [];
    const grouped = groupIds.length > 0 || aggregates.length > 0;
    for (const g of groupIds) {
      if (!dataset.columns[g]) {
        throw new BadRequestException(`ستون گروه‌بندی «${g}» معتبر نیست.`);
      }
    }

    const requestedCols =
      dto.columns && dto.columns.length > 0
        ? dto.columns
        : grouped
          ? groupIds
          : Object.keys(dataset.columns);

    const selectedColumns: Array<{ id: string; labelFa: string; type: string }> = [];
    const selectFragments: string[] = [];
    const usedNames = new Set<string>();

    for (const colId of requestedCols) {
      const colDef = dataset.columns[colId];
      if (!colDef) {
        throw new BadRequestException(`ستون «${colId}» در این مجموعه داده وجود ندارد.`);
      }
      if (grouped && !groupIds.includes(colId)) {
        throw new BadRequestException(`ستون «${colId}» باید در گروه‌بندی بیاید یا تجمیع شود.`);
      }
      if (usedNames.has(colId)) continue;
      usedNames.add(colId);
      selectedColumns.push({ id: colId, labelFa: colDef.labelFa, type: colDef.type });
      selectFragments.push(`${colDef.sqlExpr} AS "${colDef.id}"`);
    }

    for (const agg of aggregates) {
      const colDef = dataset.columns[agg.column];
      if (!colDef) {
        throw new BadRequestException(`ستون «${agg.column}» برای تجمیع یافت نشد.`);
      }
      // `includes` compares against the literal list in the whitelist, so only sum/count/avg/min/max pass.
      const func = colDef.aggregatable?.find((f) => f === agg.func);
      if (!func) {
        throw new BadRequestException(`تابع ${String(agg.func)} روی ستون ${agg.column} مجاز نیست.`);
      }
      const alias = agg.alias ?? `${func}_${agg.column}`;
      if (!AGGREGATE_ALIAS_PATTERN.test(alias)) {
        throw new BadRequestException('نام مستعار تجمیع فقط می‌تواند شامل حروف لاتین، رقم و _ باشد.');
      }
      if (usedNames.has(alias) || dataset.columns[alias]) {
        throw new BadRequestException(`نام مستعار «${alias}» تکراری است.`);
      }
      usedNames.add(alias);
      const resultType = func === 'count' ? 'number' : colDef.type === 'money' ? 'money' : colDef.type;
      selectedColumns.push({ id: alias, labelFa: `${AGGREGATE_LABEL_FA[func]} ${colDef.labelFa}`, type: resultType });
      selectFragments.push(`${func.toUpperCase()}(${colDef.sqlExpr}) AS "${alias}"`);
    }

    const params: unknown[] = [];
    const whereClauses: string[] = [`${dataset.tenantExpr} = current_setting('app.tenant_id', true)::uuid`];

    for (const f of dto.filters ?? []) {
      const colDef = dataset.columns[f.column];
      if (!colDef) {
        throw new BadRequestException(`ستون «${f.column}» برای فیلتر معتبر نیست.`);
      }
      whereClauses.push(this.compileFilterClause(colDef, f, params));
    }

    const groupByClause = groupIds.length > 0 ? `GROUP BY ${groupIds.map((g) => dataset.columns[g].sqlExpr).join(', ')}` : '';

    let orderByClause = grouped
      ? groupIds.length > 0
        ? `ORDER BY ${groupIds.map((g) => dataset.columns[g].sqlExpr).join(', ')}`
        : ''
      : `ORDER BY ${dataset.defaultOrderBy}`;
    if (dto.orderBy && dto.orderBy.length > 0) {
      const orderExprs: string[] = [];
      for (const o of dto.orderBy) {
        const colDef = dataset.columns[o.column];
        if (!colDef) {
          throw new BadRequestException(`ستون مرتب‌سازی «${o.column}» معتبر نیست.`);
        }
        if (grouped && !groupIds.includes(o.column)) {
          throw new BadRequestException(`مرتب‌سازی در گزارش گروه‌بندی‌شده فقط روی ستون‌های گروه‌بندی مجاز است.`);
        }
        // Direction is a literal chosen here, never the caller's text.
        const dir = String(o.direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        orderExprs.push(`${colDef.sqlExpr} ${dir}`);
      }
      orderByClause = `ORDER BY ${orderExprs.join(', ')}`;
    }

    const limit = this.boundedInt(dto.limit ?? DEFAULT_REPORT_LIMIT, 'limit', 1, MAX_REPORT_LIMIT);
    const offset = this.boundedInt(dto.offset ?? 0, 'offset', 0, 10_000_000);

    const fromAndWhere = `FROM ${dataset.fromSql} WHERE ${whereClauses.join(' AND ')}`;
    const limitIdx = params.length + 1;

    const sql = `
      SELECT ${selectFragments.join(', ')}
      ${fromAndWhere}
      ${groupByClause}
      ${orderByClause}
      LIMIT $${limitIdx} OFFSET $${limitIdx + 1}
    `.trim();

    const countSql =
      groupIds.length > 0
        ? `SELECT COUNT(*) AS total FROM (SELECT 1 ${fromAndWhere} ${groupByClause}) grouped_rows`
        : aggregates.length > 0
          ? `SELECT 1 AS total`
          : `SELECT COUNT(*) AS total ${fromAndWhere}`;

    return {
      sql,
      countSql,
      params: aggregates.length > 0 && groupIds.length === 0 ? [] : params,
      queryParams: [...params, limit, offset],
      selectedColumns,
    };
  }

  private boundedInt(value: unknown, name: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      throw new BadRequestException(`${name} باید عدد صحیح معتبر باشد.`);
    }
    return Math.min(value, max);
  }

  /** A filter value is a plain scalar of the column's type; objects and arrays never reach the driver. */
  private scalarFor(col: WhitelistedColumn, f: ReportFilterDto, raw: unknown): string | number | boolean {
    if (typeof raw === 'number' && !Number.isFinite(raw)) {
      throw new BadRequestException(`مقدار فیلتر ${f.column} نامعتبر است.`);
    }
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      throw new BadRequestException(`مقدار فیلتر ${f.column} باید متن، عدد یا بله/خیر باشد.`);
    }
    const text = String(raw);
    if ((col.type === 'money' || col.type === 'number') && !/^-?\d+(\.\d+)?$/.test(text)) {
      throw new BadRequestException(`مقدار فیلتر ${f.column} باید عدد باشد.`);
    }
    if (col.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new BadRequestException(`مقدار فیلتر ${f.column} باید تاریخ میلادی با قالب YYYY-MM-DD باشد.`);
    }
    return raw;
  }

  private compileFilterClause(
    col: WhitelistedColumn,
    f: ReportFilterDto,
    params: unknown[],
  ): string {
    const expr = col.sqlExpr;
    const p = (val: unknown) => {
      params.push(val);
      return `$${params.length}`;
    };
    const one = () => p(this.scalarFor(col, f, f.value));

    switch (f.op) {
      case 'eq':
        return `${expr} = ${one()}`;
      case 'neq':
        return `${expr} <> ${one()}`;
      case 'gt':
        return `${expr} > ${one()}`;
      case 'gte':
        return `${expr} >= ${one()}`;
      case 'lt':
        return `${expr} < ${one()}`;
      case 'lte':
        return `${expr} <= ${one()}`;
      case 'contains': {
        const text = String(this.scalarFor({ ...col, type: 'string' }, f, f.value));
        const escaped = text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        return `${expr}::text ILIKE ${p(`%${escaped}%`)} ESCAPE '\\'`;
      }
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        if (arr.length === 0 || arr.length > MAX_IN_VALUES) {
          throw new BadRequestException(`فیلتر in برای ${f.column} باید بین ۱ تا ${MAX_IN_VALUES} مقدار داشته باشد.`);
        }
        const values = arr.map((v) => String(this.scalarFor(col, f, v)));
        // The array element type is a literal picked from the column type, never from the caller.
        return col.type === 'string'
          ? `${expr}::text = ANY(${p(values)}::text[])`
          : `${expr} = ANY(${p(values)}::${IN_CAST[col.type]}[])`;
      }
      case 'between': {
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length !== 2) {
          throw new BadRequestException(`فیلتر between برای ${f.column} نیازمند دو مقدار شروع و پایان است.`);
        }
        const p1 = p(this.scalarFor(col, f, arr[0]));
        const p2 = p(this.scalarFor(col, f, arr[1]));
        return `${expr} BETWEEN ${p1} AND ${p2}`;
      }
      case 'is_null':
        return `${expr} IS NULL`;
      case 'is_not_null':
        return `${expr} IS NOT NULL`;
      default:
        throw new BadRequestException(`عملگر «${String(f.op)}» پشتیبانی نمی‌شود.`);
    }
  }

  /**
   * Converts a custom report query into a format-neutral ReportTable and renders XLSX or PDF.
   */
  async exportReport(
    tenantId: string,
    dto: ExportReportDto,
  ): Promise<{ body: Buffer; filename: string; contentType: string }> {
    const result = await this.executeQuery(tenantId, { ...dto, limit: dto.limit ?? MAX_REPORT_LIMIT });
    const dataset = WHITELISTED_DATASETS[dto.dataset];

    const reportColumns: ReportColumn[] = result.columns.map((c) => ({
      title: c.labelFa,
      money: c.type === 'money',
      width: c.type === 'money' || c.type === 'date' ? 1.0 : 1.5,
    }));

    const rows: ReportRow[] = result.rows.map((row) => ({
      cells: result.columns.map((col) => {
        const val = row[col.id];
        if (val == null) return null;
        if (col.type === 'money') {
          return fromDb(val as string | number);
        }
        return String(val);
      }),
    }));

    const table: ReportTable = {
      title: dto.title || dataset?.labelFa || 'گزارش سفارشی',
      subtitle: `تاریخ تهیه: ${new Date().toISOString().slice(0, 10)} | تعداد سطرها: ${result.totalRows}`,
      columns: reportColumns,
      rows,
    };

    const format = dto.format || 'xlsx';
    if (format === 'pdf') {
      const body = await writePdf(table);
      return {
        body,
        filename: `custom-report-${dto.dataset}.pdf`,
        contentType: 'application/pdf',
      };
    }

    const body = writeXlsx(table);
    return {
      body,
      filename: `custom-report-${dto.dataset}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ------------------------------------------------------------- Saved templates
  async saveTemplate(
    tenantId: string,
    userId: string,
    dto: SaveReportTemplateDto,
  ): Promise<ReportTemplateView> {
    if (!WHITELISTED_DATASETS[dto.dataset]) {
      throw new BadRequestException(`مجموعه دادهٔ «${dto.dataset}» نامعتبر است.`);
    }
    if (dto.config.dataset !== dto.dataset) {
      throw new BadRequestException('مجموعه دادهٔ الگو با تنظیمات گزارش یکسان نیست.');
    }
    this.compileQuery(dto.config); // refuses a template that could never run
    const template = await this.repo.saveTemplate(tenantId, userId, dto);
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: 'report_builder.template.saved',
      resourceType: 'report_template',
      resourceId: template.id,
      metadata: { name: template.name, dataset: template.dataset },
    });
    return template;
  }

  listTemplates(tenantId: string, dataset?: string): Promise<ReportTemplateView[]> {
    return this.repo.listTemplates(tenantId, dataset);
  }

  async getTemplate(tenantId: string, id: string): Promise<ReportTemplateView> {
    const found = await this.repo.findTemplateById(tenantId, id);
    if (!found) {
      throw new NotFoundException('الگوی گزارش یافت نشد.');
    }
    return found;
  }

  async deleteTemplate(tenantId: string, userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteTemplate(tenantId, id);
    if (!deleted) {
      throw new NotFoundException('الگوی گزارش یافت نشد.');
    }
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: 'report_builder.template.deleted',
      resourceType: 'report_template',
      resourceId: id,
    });
  }
}
