import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_ONLY, MONEY_STRING } from './project.dto';

export class CreateMovementDto {
  @ApiProperty({ description: 'تاریخ (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  date: string;

  @ApiProperty({ description: 'مبلغ (ریال، رشته اعشاری)', example: '100000000' })
  @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  amount: string;

  @ApiPropertyOptional({ description: 'کلید یکتای درخواست؛ ارسال دوباره همان کلید، سند دوم ثبت نمی‌کند' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64)
  requestKey?: string;
}
