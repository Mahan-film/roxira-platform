import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WooCommerceSyncDirection, WooCommerceSyncStatus } from '../entities/woocommerce-sync-log.entity';

export class WooCommerceSyncLogQueryDto {
  @ApiPropertyOptional({ enum: WooCommerceSyncDirection })
  @IsOptional()
  @IsEnum(WooCommerceSyncDirection)
  direction?: WooCommerceSyncDirection;

  @ApiPropertyOptional({ enum: WooCommerceSyncStatus })
  @IsOptional()
  @IsEnum(WooCommerceSyncStatus)
  status?: WooCommerceSyncStatus;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
