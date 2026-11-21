export const CORE_TENANT_TABLES = [
  'fin_chart_of_accounts',
  'fin_journal_entries',
  'fin_journal_entry_lines',
  'erp_parties',
  'invoices',
  'fin_cheques',
  'erp_stock_items',
] as const;

export type CoreTenantTableName = (typeof CORE_TENANT_TABLES)[number];
