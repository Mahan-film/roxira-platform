import { ValueTransformer } from 'typeorm';

/**
 * مبدل ستون‌های `numeric` درایور Postgres که مقدار را به‌صورت رشته
 * برمی‌گردانند. این مبدل تضمین می‌کند مبالغ ریالی در لایه Service
 * همیشه به‌صورت `number` قابل محاسبه باشند.
 */
export const numericTransformer: ValueTransformer = {
  // undefined must stay undefined so the column default applies; NULL would break NOT NULL columns.
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null): number => {
    if (value === null || value === undefined) {
      return 0;
    }
    return Number(value);
  },
};
