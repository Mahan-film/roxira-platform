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
  DEFAULT_REPORT_LIMIT,
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

export interface CompiledQuery {
  sql: string;
  countSql: string;
  params: unknown[];
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
          compiled.params,
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
      this.logger.error(`Report execution error: ${msg}`);
      throw err;
    }
  }

  /**
   * Compiles the parameterized SQL query using strictly whitelisted identifiers.
   */
  compileQuery(dto: ExecuteReportQueryDto): CompiledQuery {
    const dataset = WHITELISTED_DATASETS[dto.dataset];
    if (!dataset) {
      throw new BadRequestException(`مجموعه دادهٔ «${dto.dataset}» معتبر نیست.`);
    }

    const requestedCols = dto.columns && dto.columns.length > 0
      ? dto.columns
      : Object.keys(dataset.columns);

    const selectedColumns: Array<{ id: string; labelFa: string; type: string }> = [];
    const selectFragments: string[] = [];

    for (const colId of requestedCols) {
      const colDef = dataset.columns[colId];
      if (!colDef) {
        throw new BadRequestException(`ستون «${colId}» در این مجموعه داده وجود ندارد.`);
      }
      selectedColumns.push({ id: colId, labelFa: colDef.labelFa, type: colDef.type });
      selectFragments.push(`${colDef.sqlExpr} AS "${colId}"`);
    }

    // Add explicit aggregates if specified
    if (dto.aggregates && dto.aggregates.length > 0) {
      for (const agg of dto.aggregates) {
        const colDef = dataset.columns[agg.column];
        if (!colDef) {
          throw new BadRequestException(`ستون «${agg.column}» برای تجمیع یافت نشد.`);
        }
        if (!colDef.aggregatable?.includes(agg.func)) {
          throw new BadRequestException(`تابع ${agg.func} روی ستون ${agg.column} مجاز نیست.`);
        }
        const alias = agg.alias || `${agg.func}_${agg.column}`;
        selectFragments.push(`${agg.func.toUpperCase()}(${colDef.sqlExpr}) AS "${alias}"`);
      }
    }

    const params: unknown[] = [];
    const whereClauses: string[] = ['1=1'];

    if (dto.filters && dto.filters.length > 0) {
      for (const f of dto.filters) {
        const colDef = dataset.columns[f.column];
        if (!colDef) {
          throw new BadRequestException(`ستون «${f.column}» برای فیلتر معتبر نیست.`);
        }
        const clause = this.compileFilterClause(colDef, f, params);
        if (clause) {
          whereClauses.push(clause);
        }
      }
    }

    let groupByClause = '';
    if (dto.groupBy && dto.groupBy.length > 0) {
      const groupExprs: string[] = [];
      for (const g of dto.groupBy) {
        const colDef = dataset.columns[g];
        if (!colDef) {
          throw new BadRequestException(`ستون گروه‌بندی «${g}» معتبر نیست.`);
        }
        groupExprs.push(colDef.sqlExpr);
      }
      groupByClause = `GROUP BY ${groupExprs.join(', ')}`;
    }

    let orderByClause = `ORDER BY ${dataset.defaultOrderBy}`;
    if (dto.orderBy && dto.orderBy.length > 0) {
      const orderExprs: string[] = [];
      for (const o of dto.orderBy) {
        const colDef = dataset.columns[o.column];
        if (!colDef) {
          throw new BadRequestException(`ستون مرتب‌سازی «${o.column}» معتبر نیست.`);
        }
        const dir = o.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        orderExprs.push(`${colDef.sqlExpr} ${dir}`);
      }
      orderByClause = `ORDER BY ${orderExprs.join(', ')}`;
    }

    const limit = Math.min(dto.limit ?? DEFAULT_REPORT_LIMIT, MAX_REPORT_LIMIT);
    const offset = dto.offset ?? 0;

    const baseWhere = whereClauses.join(' AND ');
    const fromAndWhere = `FROM ${dataset.fromSql} WHERE ${baseWhere}`;

    const sql = `
      SELECT ${selectFragments.join(', ')}
      ${fromAndWhere}
      ${groupByClause}
      ${orderByClause}
      LIMIT ${limit} OFFSET ${offset}
    `.trim();

    const countSql = `
      SELECT COUNT(*) AS total
      ${fromAndWhere}
    `.trim();

    return { sql, countSql, params, selectedColumns };
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

    switch (f.op) {
      case 'eq':
        return `${expr} = ${p(f.value)}`;
      case 'neq':
        return `${expr} <> ${p(f.value)}`;
      case 'gt':
        return `${expr} > ${p(f.value)}`;
      case 'gte':
        return `${expr} >= ${p(f.value)}`;
      case 'lt':
        return `${expr} < ${p(f.value)}`;
      case 'lte':
        return `${expr} <= ${p(f.value)}`;
      case 'contains':
        return `${expr}::text ILIKE ${p(`%${String(f.value ?? '')}%`)}`;
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        return `${expr} = ANY(${p(arr)})`;
      }
      case 'between': {
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length < 2) {
          throw new BadRequestException(`فیلتر between برای ${f.column} نیازمند دو مقدار شروع و پایان است.`);
        }
        const p1 = p(arr[0]);
        const p2 = p(arr[1]);
        return `${expr} BETWEEN ${p1} AND ${p2}`;
      }
      case 'is_null':
        return `${expr} IS NULL`;
      case 'is_not_null':
        return `${expr} IS NOT NULL`;
      default:
        throw new BadRequestException(`عملگر «${f.op}» پشتیبانی نمی‌شود.`);
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
