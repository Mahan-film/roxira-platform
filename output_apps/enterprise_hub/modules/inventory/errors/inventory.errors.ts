/**
 * خطاهای دامنه ماژول انبارداری.
 *
 * این خطاها در لایه Repository/تراکنش پرتاب می‌شوند و Service آن‌ها را به
 * استثناهای معنایی HTTP نگاشت می‌کند تا وابستگی لایه پرسیستنس به HTTP حفظ نشود.
 */

/** کالای درخواستی در فهرست انبار وجود ندارد. */
export class StockItemMissingError extends Error {
  constructor(readonly sku: string) {
    super(`کالایی با شناسه ${sku} یافت نشد.`);
    this.name = 'StockItemMissingError';
  }
}

/** انبار درخواستی وجود ندارد. */
export class WarehouseMissingError extends Error {
  constructor(readonly warehouseId: number) {
    super(`انبار با شناسه ${warehouseId} یافت نشد.`);
    this.name = 'WarehouseMissingError';
  }
}

/** موجودی کافی برای خروج کالا وجود ندارد. */
export class InsufficientStockError extends Error {
  constructor(
    readonly sku: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `موجودی کافی برای کالای ${sku} وجود ندارد. درخواستی: ${requested}، موجود: ${available}.`,
    );
    this.name = 'InsufficientStockError';
  }
}
