import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetRoleAccountDto {
  @ApiProperty({ description: 'کد حساب معین یا تفصیلی سازمان برای این نقش', example: '1012' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  accountCode: string;
}

export class PostingRoleResponseDto {
  @ApiProperty() role: string;
  @ApiProperty({ description: 'برچسب فارسی نقش' }) label: string;
  @ApiProperty({ description: 'ماهیت‌های حسابی که برای این نقش مجازند', type: [String] }) types: string[];
  @ApiProperty({ nullable: true }) accountCode: string | null;
  @ApiProperty({ nullable: true }) accountName: string | null;
  @ApiProperty({ enum: ['document', 'all', 'default'], description: 'منشأ حساب: نگاشت همین سند، نگاشت همه‌ی اسناد، یا پیش‌فرض' })
  source: 'document' | 'all' | 'default';
  @ApiProperty({ description: 'حساب در دفتر کل هست، سطح معین/تفصیلی دارد و با نقش سازگار است' }) valid: boolean;
}

export class PostingTemplateResponseDto {
  @ApiProperty() docType: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: [PostingRoleResponseDto] }) roles: PostingRoleResponseDto[];
}
