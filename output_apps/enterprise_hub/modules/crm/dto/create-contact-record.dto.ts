import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ContactChannel } from '../enums/crm.enums';

/**
 * DTO ثبت سابقه تماس/تعامل با سرنخ
 * (POST /enterprise-hub/crm/leads/:id/contacts).
 *
 * در صورت عدم ارسال مشخصات فرستنده، از اطلاعات خود سرنخ پر می‌شود.
 */
export class CreateContactRecordDto {
  @ApiProperty({ description: 'موضوع تماس', example: 'تماس پیگیری پیش‌فاکتور' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subject: string;

  @ApiProperty({
    description: 'شرح خلاصه تعامل',
    example: 'مشتری خواستار تخفیف حجمی ۵٪ شد.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message: string;

  @ApiPropertyOptional({
    description: 'کانال تعامل (پیش‌فرض: PHONE)',
    enum: ContactChannel,
    default: ContactChannel.PHONE,
  })
  @IsOptional()
  @IsEnum(ContactChannel)
  channel?: ContactChannel;

  @ApiPropertyOptional({ description: 'نام فرستنده (پیش‌فرض از سرنخ)', example: 'سارا محمدی' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @ApiPropertyOptional({ description: 'شماره تماس فرستنده (پیش‌فرض از سرنخ)', example: '09121234567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  senderPhone?: string;

  @ApiPropertyOptional({ description: 'رایانامه فرستنده (پیش‌فرض از سرنخ)', example: 'sara@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  senderEmail?: string;
}
