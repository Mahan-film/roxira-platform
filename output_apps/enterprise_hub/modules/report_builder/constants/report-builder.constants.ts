export type ColumnType = 'string' | 'number' | 'money' | 'date' | 'boolean';
export type AggregateFunc = 'sum' | 'count' | 'avg' | 'min' | 'max';
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in'
  | 'between'
  | 'is_null'
  | 'is_not_null';

export interface WhitelistedColumn {
  id: string;
  sqlExpr: string;
  type: ColumnType;
  labelFa: string;
  aggregatable?: AggregateFunc[];
}

export interface WhitelistedDataset {
  id: string;
  labelFa: string;
  descriptionFa: string;
  fromSql: string;
  /** Tenant column of the driving table; every query also filters on it (belt and braces next to FORCE RLS). */
  tenantExpr: string;
  defaultOrderBy: string;
  columns: Record<string, WhitelistedColumn>;
}

export const STATEMENT_TIMEOUT_MS = 5000;
export const MAX_REPORT_LIMIT = 5000;
export const DEFAULT_REPORT_LIMIT = 100;
/** Alias of an aggregate column: a plain identifier, never free text. */
export const AGGREGATE_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export const MAX_IN_VALUES = 200;

export const WHITELISTED_DATASETS: Record<string, WhitelistedDataset> = {
  accounting_ledger: {
    id: 'accounting_ledger',
    labelFa: 'دفتر کل و اسناد حسابداری',
    descriptionFa: 'گردش حساب‌ها و سطرهای اسناد ثبت‌شده به تفکیک کد حساب، طرف‌حساب و بدهکار/بستانکار',
    fromSql: `
      "fin_journal_entry_lines" l
      JOIN "fin_journal_entries" e ON e."id" = l."journal_entry_id" AND e."tenant_id" = l."tenant_id"
      JOIN "fin_chart_of_accounts" a ON a."id" = l."account_id" AND a."tenant_id" = l."tenant_id"
    `,
    tenantExpr: 'l."tenant_id"',
    defaultOrderBy: 'e."date" DESC, l."id" ASC',
    columns: {
      date: {
        id: 'date',
        sqlExpr: 'CAST(e."date" AS date)',
        type: 'date',
        labelFa: 'تاریخ سند',
      },
      entry_number: {
        id: 'entry_number',
        sqlExpr: 'e."entry_number"',
        type: 'string',
        labelFa: 'شماره سند',
      },
      permanent_number: {
        id: 'permanent_number',
        sqlExpr: 'e."permanent_number"',
        type: 'string',
        labelFa: 'شماره قطعی',
      },
      account_code: {
        id: 'account_code',
        sqlExpr: 'a."code"',
        type: 'string',
        labelFa: 'کد حساب',
      },
      account_name: {
        id: 'account_name',
        sqlExpr: 'a."name"',
        type: 'string',
        labelFa: 'نام حساب',
      },
      party_code: {
        id: 'party_code',
        sqlExpr: 'l."party_code"',
        type: 'string',
        labelFa: 'کد تفصیلی / طرف‌حساب',
      },
      description: {
        id: 'description',
        sqlExpr: 'COALESCE(l."description", e."description")',
        type: 'string',
        labelFa: 'شرح',
      },
      debit: {
        id: 'debit',
        sqlExpr: 'l."debit"',
        type: 'money',
        labelFa: 'بدهکار (ریال)',
        aggregatable: ['sum', 'avg', 'min', 'max', 'count'],
      },
      credit: {
        id: 'credit',
        sqlExpr: 'l."credit"',
        type: 'money',
        labelFa: 'بستانکار (ریال)',
        aggregatable: ['sum', 'avg', 'min', 'max', 'count'],
      },
      status: {
        id: 'status',
        sqlExpr: 'e."status"',
        type: 'string',
        labelFa: 'وضعیت سند',
      },
    },
  },

  invoices_sales: {
    id: 'invoices_sales',
    labelFa: 'فاکتورهای فروش',
    descriptionFa: 'صورتحساب‌های فروش، مبالغ اقلام، مالیات و وضعیت پرداخت',
    fromSql: `
      "invoices" i
    `,
    tenantExpr: 'i."tenant_id"',
    defaultOrderBy: 'i."createdAt" DESC, i."id" DESC',
    columns: {
      invoice_number: {
        id: 'invoice_number',
        sqlExpr: 'i."taxInvoiceNumber"',
        type: 'string',
        labelFa: 'شماره فاکتور',
      },
      created_at: {
        id: 'created_at',
        sqlExpr: 'CAST(i."createdAt" AS date)',
        type: 'date',
        labelFa: 'تاریخ ثبت',
      },
      customer_name: {
        id: 'customer_name',
        sqlExpr: 'COALESCE(i."buyerInfo"->>\'name\', i."buyerInfo"->>\'partyCode\')',
        type: 'string',
        labelFa: 'نام خریدار / مشتری',
      },
      status: {
        id: 'status',
        sqlExpr: 'i."status"::text',
        type: 'string',
        labelFa: 'وضعیت فاکتور',
      },
      total_amount: {
        id: 'total_amount',
        sqlExpr: 'i."totalAmount"',
        type: 'money',
        labelFa: 'مبلغ ناخالص فاکتور',
        aggregatable: ['sum', 'avg', 'min', 'max', 'count'],
      },
      tax_amount: {
        id: 'tax_amount',
        sqlExpr: 'i."totalTax"',
        type: 'money',
        labelFa: 'مالیات بر ارزش افزوده',
        aggregatable: ['sum', 'avg', 'min', 'max', 'count'],
      },
      final_payable: {
        id: 'final_payable',
        sqlExpr: 'i."finalPayable"',
        type: 'money',
        labelFa: 'مبلغ نهایی قابل پرداخت',
        aggregatable: ['sum', 'avg', 'min', 'max', 'count'],
      },
    },
  },

  combined_sales_accounting: {
    id: 'combined_sales_accounting',
    labelFa: 'گزارش تلفیقی فروش و حسابداری',
    descriptionFa: 'اتصال مستقیم فاکتورهای فروش به اسناد حسابداری ثبت‌شده در دفتر روزنامه',
    fromSql: `
      "invoices" i
      LEFT JOIN "fin_journal_entries" e ON (e."id" = i."journal_entry_id" OR e."id" = i."paid_journal_entry_id") AND e."tenant_id" = i."tenant_id"
      LEFT JOIN "fin_journal_entry_lines" l ON l."journal_entry_id" = e."id" AND l."tenant_id" = e."tenant_id"
      LEFT JOIN "fin_chart_of_accounts" a ON a."id" = l."account_id" AND a."tenant_id" = l."tenant_id"
    `,
    tenantExpr: 'i."tenant_id"',
    defaultOrderBy: 'i."createdAt" DESC, i."id" DESC, l."id" ASC',
    columns: {
      invoice_number: {
        id: 'invoice_number',
        sqlExpr: 'i."taxInvoiceNumber"',
        type: 'string',
        labelFa: 'شماره فاکتور',
      },
      invoice_date: {
        id: 'invoice_date',
        sqlExpr: 'CAST(i."createdAt" AS date)',
        type: 'date',
        labelFa: 'تاریخ فاکتور',
      },
      invoice_amount: {
        id: 'invoice_amount',
        sqlExpr: 'i."finalPayable"',
        type: 'money',
        labelFa: 'مبلغ فاکتور',
        aggregatable: ['sum', 'avg', 'min', 'max'],
      },
      customer_name: {
        id: 'customer_name',
        sqlExpr: 'COALESCE(i."buyerInfo"->>\'name\', i."buyerInfo"->>\'partyCode\')',
        type: 'string',
        labelFa: 'طرف‌حساب',
      },
      voucher_number: {
        id: 'voucher_number',
        sqlExpr: 'e."entry_number"',
        type: 'string',
        labelFa: 'شماره سند حسابداری',
      },
      voucher_permanent_number: {
        id: 'voucher_permanent_number',
        sqlExpr: 'e."permanent_number"',
        type: 'string',
        labelFa: 'شماره قطعی سند',
      },
      voucher_date: {
        id: 'voucher_date',
        sqlExpr: 'CAST(e."date" AS date)',
        type: 'date',
        labelFa: 'تاریخ سند',
      },
      account_code: {
        id: 'account_code',
        sqlExpr: 'a."code"',
        type: 'string',
        labelFa: 'کد حساب معین/کل',
      },
      account_name: {
        id: 'account_name',
        sqlExpr: 'a."name"',
        type: 'string',
        labelFa: 'نام حساب',
      },
      line_debit: {
        id: 'line_debit',
        sqlExpr: 'l."debit"',
        type: 'money',
        labelFa: 'بدهکار سند',
        aggregatable: ['sum', 'avg'],
      },
      line_credit: {
        id: 'line_credit',
        sqlExpr: 'l."credit"',
        type: 'money',
        labelFa: 'بستانکار سند',
        aggregatable: ['sum', 'avg'],
      },
    },
  },
};
