import { ApiProperty } from '@nestjs/swagger';
import { DamageCalculationMethod } from '../enums/calculation-method.enum';

/**
 * DTO خروجی نتیجه محاسبه خسارت تاخیر تادیه.
 */
export class DamageCalculationResponseDto {
  @ApiProperty({ description: 'شناسه یکتای رکورد محاسبه (UUID)' })
  id: string;

  @ApiProperty({ description: 'اصل مبلغ بدهی به ریال' })
  principalAmount: number;

  @ApiProperty({ description: 'تاریخ سررسید دین' })
  dueDate: string;

  @ApiProperty({ description: 'تاریخ پرداخت واقعی' })
  paymentDate: string;

  @ApiProperty({ enum: DamageCalculationMethod, description: 'روش محاسبه' })
  calculationMethod: DamageCalculationMethod;

  @ApiProperty({ description: 'تعداد روزهای تاخیر' })
  delayedDays: number;

  @ApiProperty({ description: 'مبلغ خسارت تاخیر تادیه محاسبه‌شده به ریال' })
  damageAmount: number;

  @ApiProperty({
    description: 'مبلغ کل قابل پرداخت (اصل مبلغ + خسارت تاخیر تادیه)',
  })
  totalPayable: number;

  @ApiProperty({ description: 'مرجع قانونی مبنای محاسبه' })
  legalBasis: string;

  @ApiProperty({ required: false, description: 'شماره قرارداد/فاکتور مرجع' })
  contractReferenceNumber?: string;

  @ApiProperty({ description: 'تاریخ ثبت رکورد در سیستم' })
  createdAt: Date;
}
