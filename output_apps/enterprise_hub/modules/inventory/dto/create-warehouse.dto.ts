import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'فروشگاه صاحب این انبار' })
  @IsOptional()
  @IsInt()
  @Min(1)
  storeId?: number;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  @ApiPropertyOptional({ description: 'فعال یا غیرفعال کردن انبار (انبار دارای موجودی غیرفعال نمی‌شود)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
