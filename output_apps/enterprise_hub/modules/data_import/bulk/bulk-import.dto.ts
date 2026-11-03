import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StartBulkUploadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ description: 'حجم فایل به بایت' })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;
}

export class SignPartsDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}

export class ApproveTableDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  idx: number;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  entity: string;

  @ApiProperty({ description: 'نگاشت ستون → فیلد' })
  @IsObject()
  mapping: Record<string, string | null>;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  moneyToRial?: number;
}

export class ApproveBulkDto {
  @ApiProperty({ type: [ApproveTableDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ApproveTableDto)
  tables: ApproveTableDto[];

  @ApiProperty({ description: 'تأیید صریح کاربر پس از بازبینی' })
  @IsBoolean()
  confirmReviewed: boolean;
}
