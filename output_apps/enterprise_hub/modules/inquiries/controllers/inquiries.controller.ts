import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  INQUIRIES_RESOURCE,
  INQUIRY_THROTTLE,
} from '../constants/inquiries.constants';
import { CreateInquiryDto } from '../dto/create-inquiry.dto';
import {
  InquiryResponseDto,
  PaginatedInquiriesResponseDto,
} from '../dto/inquiry-response.dto';
import { QueryInquiryDto } from '../dto/query-inquiry.dto';
import { InquiriesService } from '../services/inquiries.service';

/**
 * کنترلر پیش‌ثبت‌نام و درخواست همکاری سازمانی.
 *
 * - `POST /v1/enterprise/inquiries` عمومی و محدود به ۵ درخواست در ساعت برای هر
 *   IP است (فرم تماس پورتال).
 * - `GET /v1/enterprise/inquiries` فقط برای نقش ADMIN (فهرست درخواست‌ها).
 *
 * فقط مسیریابی HTTP و اعتبارسنجی DTO؛ تمام منطق در InquiriesService است
 * (Rule #2 و Rule #3 - AGENTS.md).
 */
@ApiTags('Inquiries - پیش‌ثبت‌نام و درخواست همکاری')
@Controller(INQUIRIES_RESOURCE)
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Public()
  @Throttle({ default: INQUIRY_THROTTLE })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت درخواست سازمانی (پیش‌ثبت‌نام / درخواست همکاری)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: InquiryResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'محدودیت نرخ (۵ در ساعت)' })
  async create(@Body() dto: CreateInquiryDto): Promise<InquiryResponseDto> {
    return this.inquiriesService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده درخواست‌های سازمانی (فقط ADMIN)' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedInquiriesResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async list(
    @Query() query: QueryInquiryDto,
  ): Promise<PaginatedInquiriesResponseDto> {
    return this.inquiriesService.list(query);
  }
}
