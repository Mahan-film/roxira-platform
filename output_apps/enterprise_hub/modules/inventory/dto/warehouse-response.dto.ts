import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO خروجی انبار سازمانی.
 */
export class WarehouseResponseDto {
  @ApiProperty({ description: 'شناسه انبار' })
  id: number;

  @ApiProperty({ description: 'نام انبار' })
  name: string;

  @ApiProperty({ description: 'کد مکانی انبار' })
  locationCode: string;

  @ApiProperty({ description: 'فروشگاه صاحب انبار', nullable: true })
  storeId: number | null;

  @ApiProperty({ description: 'انبار فعال است' })
  isActive: boolean;

  @ApiProperty({ description: 'تاریخ ایجاد انبار' })
  createdAt: Date;
}
