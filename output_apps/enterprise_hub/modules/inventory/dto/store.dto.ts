import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateStoreDto {
  @ApiProperty({ description: 'کد یکتای فروشگاه', example: 'TEH-01' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/, { message: 'کد فروشگاه فقط حروف لاتین، عدد، خط تیره و زیرخط است.' })
  code: string;

  @ApiProperty({ description: 'نام یکتای فروشگاه', example: 'فروشگاه ونک' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'نشانی' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  address?: string;
}

export class UpdateStoreDto extends PartialType(CreateStoreDto) {
  @ApiPropertyOptional({ description: 'فعال یا غیرفعال' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StoreResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ description: 'تعداد انبارهای این فروشگاه' }) warehouseCount: number;
  @ApiProperty() createdAt: Date;
}
