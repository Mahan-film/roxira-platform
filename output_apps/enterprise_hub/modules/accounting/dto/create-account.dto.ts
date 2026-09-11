import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountType } from '../enums/accounting.enum';

/**
 * DTO ایجاد حساب جدید در دفتر کل (Chart of Accounts).
 * تمام فیلدها با class-validator اعتبارسنجی می‌شوند (Rule #2 AGENTS.md).
 */
export class CreateAccountDto {
  @ApiProperty({ description: 'کد یکتای حساب', example: '1010' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code: string;

  @ApiProperty({ description: 'نام حساب', example: 'موجودی نقد و بانک' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: 'ماهیت حساب', enum: AccountType })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional({ description: 'واحد پول حساب', example: 'IRR', default: 'IRR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}