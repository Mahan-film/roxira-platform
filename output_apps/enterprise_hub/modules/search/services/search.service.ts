import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../../accounting/money';
import { SearchEntityType, SearchItemDto, SearchResponseDto } from '../dto/search.dto';

/**
 * Exact Persian currency formatter for database numeric values via money.ts.
 * Never converts to IEEE 754 float / Number(), preventing precision loss.
 */
function formatMoneyRialsFromDb(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '۰';
  const minor = typeof value === 'bigint' ? value : fromDb(value);
  const isNeg = minor < 0n;
  const abs = isNeg ? -minor : minor;
  const rials = abs / 100n;
  const remainder = abs % 100n;
  const s = rials.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '،');
  const faDigits = s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  if (remainder > 0n) {
    const remStr = remainder.toString().padStart(2, '0').replace(/0+$/, '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    return isNeg ? `-${faDigits}.${remStr}` : `${faDigits}.${remStr}`;
  }
  return isNeg ? `-${faDigits}` : faDigits;
}

interface StaticPage {
  title: string;
  subtitle: string;
  url: string;
  keywords: string[];
  icon: string;
}

const STATIC_PAGES: readonly StaticPage[] = [
  {
    title: 'داشبورد',
    subtitle: 'پیشخوان کلی سامانه و گزارش‌های اجرایی',
    url: '/app',
    keywords: ['داشبورد', 'پیشخوان', 'گزارش', 'خانه', 'home', 'dashboard'],
    icon: 'LayoutDashboard',
  },
  {
    title: 'دستیار هوشمند',
    subtitle: 'مشاوره مالی، حقوقی و پردازش اسناد با هوش مصنوعی',
    url: '/app/assistant',
    keywords: ['دستیار', 'هوش مصنوعی', 'ai', 'چت', 'مشاوره', 'assistant'],
    icon: 'MessageSquareText',
  },
  {
    title: 'مشتریان و طرف‌حساب‌ها',
    subtitle: 'مدیریت مشتریان، خریداران، تأمین‌کنندگان و بدهکاران',
    url: '/app/crm',
    keywords: ['مشتری', 'طرف حساب', 'تامین کننده', 'خریدار', 'crm', 'party', 'customer', 'supplier'],
    icon: 'Users',
  },
  {
    title: 'کالا و انبارداری',
    subtitle: 'موجودی انبار، کاردکس کالا، نقطه سفارش و قیمت‌گذاری',
    url: '/app/inventory',
    keywords: ['کالا', 'انبار', 'موجودی', 'کاردکس', 'stock', 'inventory', 'warehouse', 'sku'],
    icon: 'Package',
  },
  {
    title: 'فرمول ساخت و تولید (BOM)',
    subtitle: 'فرمول‌های تولید، سفارش‌های ساخت و کنترل ضایعات',
    url: '/app/inventory/production',
    keywords: ['تولید', 'فرمول ساخت', 'bom', 'سفارش ساخت', 'production'],
    icon: 'Factory',
  },
  {
    title: 'صورتحساب‌ها و فاکتورها',
    subtitle: 'صدور صورتحساب فروش، پیش‌فاکتور، فاکتور خرید و ارجاع',
    url: '/app/invoicing',
    keywords: ['فاکتور', 'صورتحساب', 'فروش', 'خرید', 'invoice', 'bill', 'sales'],
    icon: 'FileText',
  },
  {
    title: 'پایانه فروشگاهی (POS)',
    subtitle: 'ثبت سریع فروش، صندوق فروشگاهی و تسویه آنی',
    url: '/app/invoicing/pos',
    keywords: ['پایانه', 'pos', 'صندوق', 'فروش سریع', 'بارکدخوان'],
    icon: 'ShoppingCart',
  },
  {
    title: 'مدیریت چک‌ها و سامانه صیاد',
    subtitle: 'چک‌های دریافتی، پرداختی، خرج‌شده، واگذارشده و استعلام صیاد',
    url: '/app/cheques',
    keywords: ['چک', 'صیاد', 'چک صیادی', 'خزانه', 'cheque', 'sayad'],
    icon: 'CreditCard',
  },
  {
    title: 'خزانه‌داری و نقدینگی',
    subtitle: 'صندوق‌ها، حساب‌های بانکی، تنخواه‌گردان و صورت مغایرت',
    url: '/app/treasury',
    keywords: ['خزانه', 'بانک', 'صندوق', 'تنخواه', 'مغایرت', 'treasury', 'banking', 'cash'],
    icon: 'Wallet',
  },
  {
    title: 'سامانه مودیان و کارپوشه مالیاتی',
    subtitle: 'ارسال صورتحساب‌های الکترونیکی، وضعیت کارپوشه و استعلام مالیاتی',
    url: '/app/tax',
    keywords: ['مالیات', 'مودیان', 'سامانه مودیان', 'کارپوشه', 'ارزش افزوده', 'tax', 'moadian'],
    icon: 'Receipt',
  },
  {
    title: 'اسناد حسابداری',
    subtitle: 'دفتر روزنامه، صدور سند حسابداری، اسناد اتوماتیک و یادداشت',
    url: '/app/accounting/vouchers',
    keywords: ['سند', 'حسابداری', 'دفتر روزنامه', 'رویداد', 'voucher', 'journal'],
    icon: 'BookOpen',
  },
  {
    title: 'کدینگ و درخت حساب‌ها',
    subtitle: 'ساختار کل، معین، تفصیلی و تعریف حساب‌های دفتر کل',
    url: '/app/accounting/chart',
    keywords: ['کدینگ', 'حساب', 'کل', 'معین', 'تفصیلی', 'chart', 'accounts'],
    icon: 'FolderTree',
  },
  {
    title: 'سال‌ها و دوره‌های مالی',
    subtitle: 'تعریف سال مالی، بستن حساب‌های موقت و دائم و دوره‌های گزارش‌گیری',
    url: '/app/accounting/fiscal-years',
    keywords: ['سال مالی', 'دوره مالی', 'بستن سال', 'fiscal year'],
    icon: 'Calendar',
  },
  {
    title: 'گزارش‌های جامع مالی',
    subtitle: 'تراز آزمایشی، سود و زیان، ترازنامه، گزارش دفاتر قانونی و سن مطالبات',
    url: '/app/accounting/reports',
    keywords: ['ترازنامه', 'سود و زیان', 'تراز آزمایشی', 'گزارش مالی', 'reports', 'balance sheet'],
    icon: 'BarChart3',
  },
  {
    title: 'ورود اطلاعات و اکسل',
    subtitle: 'دریافت دسته‌ای فایل‌های اکسل، سپیدار، هلو و همکاران سیستم',
    url: '/app/import',
    keywords: ['اکسل', 'مهاجرت', 'ورود داده', 'import', 'excel', 'csv', 'sepidar'],
    icon: 'FileUp',
  },
  {
    title: 'مدیریت کاربران و دسترسی‌ها',
    subtitle: 'تنظیمات اعضا، نقش‌های سفارشی، شعب و سیاست‌های امنیتی',
    url: '/app/settings/members',
    keywords: ['کاربر', 'دسترسی', 'نقش', 'شعبه', 'تنظیمات', 'امنیت', 'settings', 'members'],
    icon: 'ShieldCheck',
  },
];

/**
 * Normalizes Persian and Arabic text and digits into canonical form for database matching.
 */
export function normalizeSearchQuery(text: string): string {
  if (!text) return '';
  let s = text.trim();
  // Persian digits -> ASCII
  s = s.replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  // Arabic digits -> ASCII
  s = s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  // Arabic Yeh -> Persian Ye
  s = s.replace(/\u064A/g, '\u06CC');
  // Arabic Kaf -> Persian Ke
  s = s.replace(/\u0643/g, '\u06A9');
  return s;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly tenantScope: TenantScope,
    private readonly dataSource: DataSource,
  ) {}

  async search(
    tenantId: string,
    rawQuery: string,
    limit = 20,
    types?: SearchEntityType[],
  ): Promise<SearchResponseDto> {
    const startTime = Date.now();
    const query = normalizeSearchQuery(rawQuery);
    if (!query) {
      return {
        query: rawQuery,
        total: 0,
        items: [],
        latencyMs: Date.now() - startTime,
      };
    }

    const typeSet = types && types.length > 0 ? new Set(types) : null;
    const shouldSearch = (t: SearchEntityType) => !typeSet || typeSet.has(t);

    const perTypeLimit = Math.max(5, Math.ceil(limit / 2));
    const likePattern = `%${query}%`;

    const searchStaticPages = (): SearchItemDto[] => {
      if (!shouldSearch('page')) return [];
      const qLower = query.toLowerCase();
      const hits: SearchItemDto[] = [];
      for (const page of STATIC_PAGES) {
        let match = false;
        let score = 0;
        if (page.title.toLowerCase().includes(qLower)) {
          match = true;
          score = 0.95;
        } else if (page.subtitle.toLowerCase().includes(qLower)) {
          match = true;
          score = 0.8;
        } else if (page.keywords.some((k) => k.toLowerCase().includes(qLower))) {
          match = true;
          score = 0.7;
        }
        if (match) {
          hits.push({
            id: page.url,
            type: 'page',
            title: page.title,
            subtitle: page.subtitle,
            url: page.url,
            icon: page.icon,
            score,
          });
        }
      }
      return hits.slice(0, perTypeLimit);
    };

    const results = await this.tenantScope.run(tenantId, async (manager) => {
      const promises: Array<Promise<SearchItemDto[]>> = [];

      // 1. Parties (Customers & Suppliers)
      if (shouldSearch('customer') || shouldSearch('supplier')) {
        promises.push(
          manager
            .query(
              `SELECT id, code, name, role, national_id, economic_code, phone,
                      similarity(name, $3) AS sim
               FROM erp_parties
               WHERE tenant_id = $1
                 AND active = true
                 AND (name ILIKE $2 OR code ILIKE $2 OR national_id ILIKE $2 OR phone ILIKE $2)
               ORDER BY sim DESC, id DESC
               LIMIT $4`,
              [tenantId, likePattern, query, perTypeLimit],
            )
            .then((rows: any[]) =>
              rows.map((row): SearchItemDto => {
                const isSupplier = String(row.role).toLowerCase() === 'supplier';
                const type: SearchEntityType = isSupplier ? 'supplier' : 'customer';
                const parts: string[] = [`کد: ${row.code}`];
                if (row.national_id) parts.push(`شناسه ملی: ${row.national_id}`);
                if (row.phone) parts.push(`تلفن: ${row.phone}`);
                return {
                  id: String(row.id),
                  type,
                  title: row.name,
                  subtitle: parts.join(' | '),
                  url: `/app/crm?search=${encodeURIComponent(row.code)}`,
                  icon: isSupplier ? 'Truck' : 'Users',
                  score: Number(row.sim ?? 0.5),
                };
              }),
            )
            .catch((err) => {
              this.logger.warn(`Failed searching erp_parties for tenant ${tenantId}: ${err?.message || err}`);
              return [];
            }),
        );
      }

      // 2. Stock items / Products
      if (shouldSearch('product')) {
        promises.push(
          manager
            .query(
              `SELECT id, sku, barcode, name, primary_unit, quantity,
                      similarity(name, $3) AS sim
               FROM erp_stock_items
               WHERE tenant_id = $1
                 AND (name ILIKE $2 OR sku ILIKE $2 OR barcode ILIKE $2)
               ORDER BY sim DESC, id DESC
               LIMIT $4`,
              [tenantId, likePattern, query, perTypeLimit],
            )
            .then((rows: any[]) =>
              rows.map((row): SearchItemDto => {
                const parts: string[] = [`کد کالا: ${row.sku}`];
                if (row.barcode) parts.push(`بارکد: ${row.barcode}`);
                if (row.quantity != null) {
                  parts.push(`موجودی: ${row.quantity} ${row.primary_unit || 'عدد'}`);
                }
                return {
                  id: String(row.id),
                  type: 'product',
                  title: row.name,
                  subtitle: parts.join(' | '),
                  url: `/app/inventory?search=${encodeURIComponent(row.sku)}`,
                  icon: 'Package',
                  score: Number(row.sim ?? 0.5),
                };
              }),
            )
            .catch((err) => {
              this.logger.warn(`Failed searching erp_stock_items for tenant ${tenantId}: ${err?.message || err}`);
              return [];
            }),
        );
      }

      // 3. Invoices & Bills
      if (shouldSearch('invoice') || shouldSearch('bill')) {
        promises.push(
          manager
            .query(
              `SELECT id, "taxInvoiceNumber" AS tax_invoice_number, direction, "finalPayable" AS final_payable, currency, status,
                      "buyerInfo" AS buyer_info, "sellerInfo" AS seller_info, "createdAt" AS created_at,
                      similarity("taxInvoiceNumber", $3) AS sim
               FROM invoices
               WHERE tenant_id = $1
                 AND ("taxInvoiceNumber" ILIKE $2
                      OR ("buyerInfo"->>'name') ILIKE $2
                      OR ("sellerInfo"->>'name') ILIKE $2)
               ORDER BY sim DESC, "createdAt" DESC
               LIMIT $4`,
              [tenantId, likePattern, query, perTypeLimit],
            )
            .then((rows: any[]) =>
              rows.map((row): SearchItemDto => {
                const isBill = row.direction === 'PURCHASE';
                const partyName = isBill
                  ? row.seller_info?.name || 'تأمین‌کننده'
                  : row.buyer_info?.name || 'خریدار';
                const formattedAmount = formatMoneyRialsFromDb(row.final_payable);
                return {
                  id: String(row.id),
                  type: isBill ? 'bill' : 'invoice',
                  title: `صورتحساب ${row.tax_invoice_number}`,
                  subtitle: `${partyName} | مبلغ: ${formattedAmount} ${row.currency || 'IRR'}`,
                  url: `/app/invoicing?search=${encodeURIComponent(row.tax_invoice_number)}`,
                  icon: isBill ? 'Receipt' : 'FileText',
                  score: Number(row.sim ?? 0.5),
                };
              }),
            )
            .catch((err) => {
              this.logger.warn(`Failed searching invoices for tenant ${tenantId}: ${err?.message || err}`);
              return [];
            }),
        );
      }

      // 4. Cheques
      if (shouldSearch('cheque')) {
        promises.push(
          manager
            .query(
              `SELECT id, cheque_number, sayad_number, party_name, bank_name, amount,
                      due_date, direction, status,
                      similarity(cheque_number, $3) AS sim
               FROM fin_cheques
               WHERE tenant_id = $1
                 AND (cheque_number ILIKE $2 OR sayad_number ILIKE $2 OR party_name ILIKE $2)
               ORDER BY sim DESC, due_date DESC
               LIMIT $4`,
              [tenantId, likePattern, query, perTypeLimit],
            )
            .then((rows: any[]) =>
              rows.map((row): SearchItemDto => {
                const formattedAmount = formatMoneyRialsFromDb(row.amount);
                const parts: string[] = [
                  `طرف‌حساب: ${row.party_name}`,
                  `سررسید: ${row.due_date}`,
                  `مبلغ: ${formattedAmount} ریال`,
                ];
                if (row.sayad_number) parts.push(`صیاد: ${row.sayad_number}`);
                return {
                  id: String(row.id),
                  type: 'cheque',
                  title: `چک شماره ${row.cheque_number} (${row.bank_name || 'بانک'})`,
                  subtitle: parts.join(' | '),
                  url: `/app/cheques?search=${encodeURIComponent(row.cheque_number)}`,
                  icon: 'CreditCard',
                  score: Number(row.sim ?? 0.5),
                };
              }),
            )
            .catch((err) => {
              this.logger.warn(`Failed searching fin_cheques for tenant ${tenantId}: ${err?.message || err}`);
              return [];
            }),
        );
      }

      // 5. Chart of Accounts
      if (shouldSearch('account')) {
        promises.push(
          manager
            .query(
              `SELECT id, code, name, level, account_type,
                      similarity(name, $3) AS sim
               FROM fin_chart_of_accounts
               WHERE tenant_id = $1
                 AND (code ILIKE $2 OR name ILIKE $2)
               ORDER BY sim DESC, code ASC
               LIMIT $4`,
              [tenantId, likePattern, query, perTypeLimit],
            )
            .then((rows: any[]) =>
              rows.map((row): SearchItemDto => ({
                id: String(row.id),
                type: 'account',
                title: `${row.code} - ${row.name}`,
                subtitle: `سطح: ${row.level || 'معین'} | ماهیت: ${row.account_type || 'دارایی'}`,
                url: `/app/accounting/chart?code=${encodeURIComponent(row.code)}`,
                icon: 'BookOpen',
                score: Number(row.sim ?? 0.5),
              })),
            )
            .catch((err) => {
              this.logger.warn(`Failed searching fin_chart_of_accounts for tenant ${tenantId}: ${err?.message || err}`);
              return [];
            }),
        );
      }

      const entityGroups = await Promise.all(promises);
      const pageHits = searchStaticPages();

      const combined: SearchItemDto[] = [...pageHits, ...entityGroups.flat()];
      // Rank results by score descending
      combined.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return combined.slice(0, limit);
    });

    const latencyMs = Date.now() - startTime;
    return {
      query: rawQuery,
      total: results.length,
      items: results,
      latencyMs,
    };
  }
}
