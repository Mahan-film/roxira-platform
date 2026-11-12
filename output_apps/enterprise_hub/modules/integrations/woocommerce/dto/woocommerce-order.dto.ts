import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class WooCommerceBillingDto {
  @IsOptional() @IsString() first_name?: string;
  @IsOptional() @IsString() last_name?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() address_1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postcode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

export class WooCommerceLineItemDto {
  @IsNumber() id: number;
  @IsString() name: string;
  @IsNumber() product_id: number;
  @IsOptional() @IsNumber() variation_id?: number;
  @IsNumber() quantity: number;
  @IsOptional() @IsString() subtotal?: string;
  @IsOptional() @IsString() subtotal_tax?: string;
  @IsOptional() @IsString() total?: string;
  @IsOptional() @IsString() total_tax?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() price?: number | string;
}

export class WooCommerceOrderWebhookDto {
  @ApiProperty({ description: 'شناسه سفارش در ووکامرس', example: 1024 })
  @IsNumber()
  id: number;

  @ApiPropertyOptional({ description: 'شماره نمایشی سفارش' })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({ description: 'وضعیت سفارش در ووکامرس', example: 'processing' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'واحد پول', default: 'IRR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'مبلغ کل سفارش', example: '2500000' })
  @IsString()
  total: string;

  @ApiPropertyOptional({ description: 'مجموع مالیات', default: '0' })
  @IsOptional()
  @IsString()
  total_tax?: string;

  @ApiPropertyOptional({ description: 'مجموع تخفیف', default: '0' })
  @IsOptional()
  @IsString()
  discount_total?: string;

  @ApiPropertyOptional({ description: 'هزینه ارسال', default: '0' })
  @IsOptional()
  @IsString()
  shipping_total?: string;

  @ApiPropertyOptional({ description: 'اطلاعات خریدار' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WooCommerceBillingDto)
  billing?: WooCommerceBillingDto;

  @ApiProperty({ description: 'سطرهای سفارش', type: [WooCommerceLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WooCommerceLineItemDto)
  line_items: WooCommerceLineItemDto[];
}
