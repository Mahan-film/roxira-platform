import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DimensionKind } from '../enums/accounting.enum';

export class CreateDimensionDto {
  @ApiProperty({ enum: DimensionKind, description: 'تفصیلی شناور، مرکز هزینه یا مرکز پروژه' })
  @IsEnum(DimensionKind)
  kind: DimensionKind;

  @ApiProperty({ example: 'CC-100' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,32}$/, { message: 'کد فقط حروف لاتین، عدد و . _ - تا ۳۲ نویسه' })
  code: string;

  @ApiProperty({ example: 'واحد فروش' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiPropertyOptional({ example: 'CC-100', description: 'کد مرکز هزینهٔ بالادست (فقط برای مرکز هزینه)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,32}$/, { message: 'کد فقط حروف لاتین، عدد و . _ - تا ۳۲ نویسه' })
  parentCode?: string;
}

export class DimensionListQueryDto {
  @ApiPropertyOptional({ enum: DimensionKind })
  @IsOptional()
  @IsEnum(DimensionKind)
  kind?: DimensionKind;
}

export class DimensionBalancesQueryDto {
  @ApiProperty({ example: '2026-03-21' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ example: '2027-03-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

export class CreateDimensionRuleDto {
  @ApiProperty({ example: 'Project required when CostCenter is CC-RND' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiPropertyOptional({ example: 'EXPENSE' })
  @IsOptional()
  @IsString()
  accountType?: string;

  @ApiPropertyOptional({ example: '5020' })
  @IsOptional()
  @IsString()
  accountCode?: string;

  @ApiPropertyOptional({ enum: DimensionKind, example: DimensionKind.COST_CENTER })
  @IsOptional()
  @IsEnum(DimensionKind)
  whenDimensionKind?: DimensionKind;

  @ApiPropertyOptional({ example: 'CC-RND' })
  @IsOptional()
  @IsString()
  whenDimensionCode?: string;

  @ApiProperty({ enum: DimensionKind, example: DimensionKind.PROJECT })
  @IsEnum(DimensionKind)
  requiresDimensionKind: DimensionKind;
}

export class RenameDimensionDto {
  @ApiProperty({ example: 'CC-EMEA-SALES' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,32}$/)
  newCode: string;

  @ApiProperty({ example: 'EMEA Sales' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newName: string;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom: string;
}
