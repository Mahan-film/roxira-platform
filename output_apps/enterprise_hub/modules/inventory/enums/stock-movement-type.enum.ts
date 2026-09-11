/**
 * نوع گردش انبار: ورود کالا (Inbound) یا خروج کالا (Outbound).
 */
export enum StockMovementType {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  [StockMovementType.INBOUND]: 'ورود کالا',
  [StockMovementType.OUTBOUND]: 'خروج کالا',
};
