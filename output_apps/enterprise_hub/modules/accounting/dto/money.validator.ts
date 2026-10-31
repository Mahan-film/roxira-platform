import { registerDecorator, ValidationOptions } from 'class-validator';
import { MONEY_SCALE } from '../constants/accounting.constants';

const MAX_SAFE_MAJOR = Number.MAX_SAFE_INTEGER / 10 ** MONEY_SCALE;

/**
 * A non-negative money amount: a JSON number (exact only up to ~9e13 with 2 decimals) or a decimal
 * string "1234.56" (the exact transport for larger amounts). At most `scale` decimals, at most 16
 * integer digits (numeric(18,2)); never silently rounded.
 */
export function IsMoneyAmount(scale = MONEY_SCALE, options?: ValidationOptions) {
  const pattern = new RegExp(`^\\d{1,16}(\\.\\d{1,${scale}})?$`);
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isMoneyAmount',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a non-negative amount with at most ${scale} decimals (use a decimal string above ${MAX_SAFE_MAJOR}).`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'string') {
            return pattern.test(value.trim());
          }
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return false;
          }
          if (value > MAX_SAFE_MAJOR) {
            return false;
          }
          const decimals = (value.toString().split('.')[1] ?? '').length;
          return !value.toString().includes('e') && decimals <= scale;
        },
      },
    });
  };
}
