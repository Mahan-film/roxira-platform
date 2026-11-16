import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export type SearchEntityType =
  | 'customer'
  | 'supplier'
  | 'product'
  | 'invoice'
  | 'bill'
  | 'cheque'
  | 'account'
  | 'page';

export class SearchQueryDto {
  @ApiProperty({
    description: 'عبارت جستجو (حداقل ۱ کاراکتر)',
    example: 'فروشگاه آلفا',
  })
  @IsString()
  @MinLength(1, { message: 'عبارت جستجو نباید خالی باشد.' })
  @MaxLength(100, { message: 'طول عبارت جستجو نمی‌تواند بیش از ۱۰۰ کاراکتر باشد.' })
  q: string;

  @ApiPropertyOptional({
    description: 'حداکثر تعداد نتایج بازگشتی (پیش‌فرض ۲۰)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'تعداد نتایج باید عدد صحیح باشد.' })
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'فیلتر بر اساس نوع موجودیت',
    example: ['customer', 'invoice', 'product'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: SearchEntityType[];
}

export class SearchItemDto {
  @ApiProperty({ description: 'شناسه موجودیت', example: '101' })
  id: string;

  @ApiProperty({
    description: 'نوع موجودیت',
    enum: ['customer', 'supplier', 'product', 'invoice', 'bill', 'cheque', 'account', 'page'],
    example: 'customer',
  })
  type: SearchEntityType;

  @ApiProperty({ description: 'عنوان اصلی نتیجه', example: 'شرکت تجارت الکترونیک آلفا' })
  title: string;

  @ApiProperty({ description: 'توضیحات فرعی یا کد شناسایی', example: 'کد طرف‌حساب: C-1002 | شناسه ملی: 10103456789' })
  subtitle: string;

  @ApiProperty({ description: 'آدرس مستقیم در سامانه', example: '/app/crm?search=C-1002' })
  url: string;

  @ApiPropertyOptional({ description: 'نام آیکون نمایشی', example: 'Users' })
  icon?: string;

  @ApiPropertyOptional({ description: 'امتیاز تطابق (Similarity Score)', example: 0.85 })
  score?: number;
}

export class SearchResponseDto {
  @ApiProperty({ description: 'عبارت جستجوشده', example: 'آلفا' })
  query: string;

  @ApiProperty({ description: 'مجموع نتایج بازگشتی', example: 5 })
  total: number;

  @ApiProperty({ description: 'آیتم‌های نتیجه جستجو', type: [SearchItemDto] })
  items: SearchItemDto[];

  @ApiProperty({ description: 'مدت‌زمان اجرای کوئری به میلی‌ثانیه', example: 12 })
  latencyMs: number;
}
