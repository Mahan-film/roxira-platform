import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO ایجاد انبار جدید (POST /enterprise-hub/inventory/warehouses).
 */
export class CreateWarehouseDto {
  @ApiProperty({ description: 'نام یکتای انبار', example: 'انبار مرکزی تهران' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'کد مکانی انبار', example: 'THR-CENTRAL-01' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  locationCode: string;
}
