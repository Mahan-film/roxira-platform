import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateBulkDamageCalculationDto,
  CreateDamageCalculationDto,
} from '../dto/create-damage-calculation.dto';
import { DamageCalculationResponseDto } from '../dto/damage-calculation-response.dto';
import { QueryDamageCalculationDto } from '../dto/query-damage-calculation.dto';
import { DamagesService } from '../services/damages.service';

/**
 * کنترلر ماژول خسارت تاخیر تادیه.
 * فقط مسیریابی و اعتبارسنجی HTTP انجام می‌دهد؛ هیچ منطق کسب‌وکار یا
 * دسترسی مستقیم به پایگاه‌داده در این لایه وجود ندارد (Rule #3 - AGENTS.md).
 */
@ApiTags('Damages - خسارت تاخیر تادیه')
@Controller('enterprise-hub/damages')
export class DamagesController {
  constructor(private readonly damagesService: DamagesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'محاسبه خسارت تاخیر تادیه',
    description:
      'محاسبه فوری خسارت تاخیر تادیه بر اساس شاخص بانک مرکزی (ماده ۵۲۲ آیین دادرسی مدنی) یا نرخ سود سالانه قراردادی.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: DamageCalculationResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  async create(
    @Body() dto: CreateDamageCalculationDto,
  ): Promise<DamageCalculationResponseDto> {
    return this.damagesService.calculateAndPersist(dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'محاسبه دسته‌ای خسارت تاخیر تادیه (ناهمزمان)',
    description:
      'درخواست پردازش دسته‌ای را در صف Redis/BullMQ قرار می‌دهد و بلادرنگ شناسه Job را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: 'درخواست در صف پردازش قرار گرفت' })
  async createBulk(
    @Body() dto: CreateBulkDamageCalculationDto,
  ): Promise<{ jobId: string; itemCount: number }> {
    return this.damagesService.enqueueBulkCalculation(dto.items);
  }

  @Get()
  @ApiOperation({ summary: 'فهرست رکوردهای محاسبه‌شده به همراه صفحه‌بندی' })
  @ApiResponse({ status: HttpStatus.OK })
  async findAll(@Query() query: QueryDamageCalculationDto) {
    return this.damagesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'دریافت یک رکورد محاسبه بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: DamageCalculationResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'رکورد یافت نشد' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DamageCalculationResponseDto> {
    return this.damagesService.findOne(id);
  }
}
