import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class GenerateLinkCodeResponseDto {
  @ApiProperty({ description: 'کد ۶ رقمی یکبار مصرف اتصال', example: '849201' })
  code: string;

  @ApiProperty({ description: 'زمان انقضای کد (۱۰ دقیقه)' })
  expiresAt: Date;

  @ApiProperty({ description: 'نام کاربری ربات تلگرام', nullable: true })
  botUsername: string | null;

  @ApiProperty({ description: 'لینک مستقیم شروع اتصال در تلگرام', nullable: true })
  deepLink: string | null;
}

export class ReceiptBotStatusResponseDto {
  @ApiProperty({ description: 'آیا حساب کاربر به بات متصل است؟' })
  linked: boolean;

  @ApiProperty({ description: 'نام کاربری تلگرام متصل‌شده', nullable: true })
  telegramUsername: string | null;

  @ApiProperty({ description: 'برچسب یا نوع پیش‌فرض پیش‌نویس (تنخواه‌گردان یا خرید)', example: 'petty_cash' })
  defaultKind: 'petty_cash' | 'purchase';

  @ApiProperty({ description: 'آیا توکن ربات در سرور تنظیم شده است؟' })
  botConfigured: boolean;

  @ApiProperty({ description: 'نام کاربری ربات', nullable: true })
  botUsername: string | null;
}

export class UpdateReceiptBotPreferencesDto {
  @ApiProperty({
    description: 'حالت پیش‌فرض برچسب/نوع پیش‌نویس خرید برای رسیدهای دریافتی از ربات',
    enum: ['petty_cash', 'purchase'],
    example: 'petty_cash',
  })
  @IsString()
  @IsIn(['petty_cash', 'purchase'], {
    message: 'نوع پیش‌فرض باید یا petty_cash (برچسب تنخواه‌گردان) یا purchase (فاکتور خرید) باشد.',
  })
  defaultKind: 'petty_cash' | 'purchase';
}

export class TelegramUserDto {
  @IsNumber()
  id: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  last_name?: string;
}

export class TelegramChatDto {
  @IsNumber()
  id: number;

  @IsOptional()
  @IsString()
  type?: string;
}

export class TelegramPhotoSizeDto {
  @IsString()
  file_id: string;

  @IsString()
  file_unique_id: string;

  @IsInt()
  width: number;

  @IsInt()
  height: number;

  @IsOptional()
  @IsInt()
  file_size?: number;
}

export class TelegramDocumentDto {
  @IsString()
  file_id: string;

  @IsString()
  file_unique_id: string;

  @IsOptional()
  @IsString()
  file_name?: string;

  @IsOptional()
  @IsString()
  mime_type?: string;

  @IsOptional()
  @IsInt()
  file_size?: number;
}

export class TelegramMessageDto {
  @IsInt()
  message_id: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramUserDto)
  from?: TelegramUserDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TelegramChatDto)
  chat: TelegramChatDto;

  @IsOptional()
  @IsInt()
  date?: number;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TelegramPhotoSizeDto)
  photo?: TelegramPhotoSizeDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramDocumentDto)
  document?: TelegramDocumentDto;
}

export class TelegramUpdateDto {
  @IsInt()
  update_id: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessageDto)
  message?: TelegramMessageDto;
}
