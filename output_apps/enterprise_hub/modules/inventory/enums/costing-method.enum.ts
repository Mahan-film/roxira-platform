/**
 * روش‌های ارزش‌گذاری موجودی انبار.
 * - FIFO: First-In, First-Out (نخستین صادره از نخستین وارده)
 * - AVCO: Average Cost (میانگین متحرک)
 * - STANDARD: Standard Cost (بهای تمام‌شده استاندارد با محاسبه انحراف نرخ خرید PPV)
 */
export enum CostingMethod {
  FIFO = 'FIFO',
  AVCO = 'AVCO',
  STANDARD = 'STANDARD',
}
