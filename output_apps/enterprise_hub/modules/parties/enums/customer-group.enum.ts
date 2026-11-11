/**
 * Customer tiers for tiered pricing lists (#230 / T74).
 * - CONSUMER: Standard end-user retail pricing (مصرف‌کننده)
 * - WHOLESALE: Bulk wholesale purchasing tier (عمده‌فروشی)
 * - PARTNER: Business partner / reseller preferred tier (همکار)
 */
export enum CustomerGroup {
  CONSUMER = 'consumer',
  WHOLESALE = 'wholesale',
  PARTNER = 'partner',
}
