import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AddLeadNoteDto } from '../dto/add-lead-note.dto';
import {
  ContactMessageResponseDto,
  PaginatedContactMessagesResponseDto,
} from '../dto/contact-message-response.dto';
import {
  LeadResponseDto,
  PaginatedLeadsResponseDto,
} from '../dto/crm-lead-response.dto';
import { CreateContactRecordDto } from '../dto/create-contact-record.dto';
import { CreateLeadDto } from '../dto/create-lead.dto';
import {
  LeadStatsResponseDto,
  PipelineStageGroupDto,
} from '../dto/pipeline-stats-response.dto';
import {
  QueryContactRecordDto,
  QueryLeadDto,
} from '../dto/query-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { UpdateLeadStageDto } from '../dto/update-lead-stage.dto';
import { CrmService } from '../services/crm.service';

/**
 * کنترلر CRM و مدیریت پایپ‌لاین سرنخ‌های فروش.
 *
 * فقط مسیریابی و اعتبارسنجی DTO؛ هیچ منطق کسب‌وکار یا دسترسی مستقیم به
 * پایگاه‌داده در این لایه وجود ندارد (Rule #3 - AGENTS.md).
 */
@ApiTags('CRM - مدیریت مشتریان و پایپ‌لاین فروش')
@Controller('enterprise-hub/crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // ---------------------------------------------------------------------------
  // سرنخ‌ها
  // ---------------------------------------------------------------------------

  @Post('leads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت سرنخ فروش جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: LeadResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'رایانامه تکراری است' })
  async createLead(@Body() dto: CreateLeadDto): Promise<LeadResponseDto> {
    return this.crmService.createLead(dto);
  }

  @Get('leads')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده سرنخ‌ها با فیلتر مرحله و جست‌وجو' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedLeadsResponseDto })
  async listLeads(
    @Query() query: QueryLeadDto,
  ): Promise<PaginatedLeadsResponseDto> {
    return this.crmService.listLeads(query);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'دریافت یک سرنخ بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: LeadResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  async getLead(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LeadResponseDto> {
    return this.crmService.getLead(id);
  }

  @Patch('leads/:id')
  @ApiOperation({ summary: 'ویرایش اطلاعات سرنخ' })
  @ApiResponse({ status: HttpStatus.OK, type: LeadResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'رایانامه تکراری است' })
  async updateLead(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
  ): Promise<LeadResponseDto> {
    return this.crmService.updateLead(id, dto);
  }

  @Patch('leads/:id/stage')
  @ApiOperation({
    summary: 'انتقال سرنخ بین مراحل فروش',
    description:
      'مراحل مجاز: NEW, CONTACTED, QUALIFIED, PROPOSAL, WON, LOST.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: LeadResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  async updateLeadStage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadStageDto,
  ): Promise<LeadResponseDto> {
    return this.crmService.updateLeadStage(id, dto);
  }

  @Post('leads/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'افزودن یادداشت زمان‌دار به سابقه سرنخ' })
  @ApiResponse({ status: HttpStatus.CREATED, type: LeadResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  async addLeadNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddLeadNoteDto,
  ): Promise<LeadResponseDto> {
    return this.crmService.addLeadNote(id, dto);
  }

  // ---------------------------------------------------------------------------
  // سوابق تماس
  // ---------------------------------------------------------------------------

  @Get('leads/:id/contacts')
  @ApiOperation({ summary: 'فهرست سوابق تماس یک سرنخ' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedContactMessagesResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  async listContactRecords(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryContactRecordDto,
  ): Promise<PaginatedContactMessagesResponseDto> {
    return this.crmService.listContactRecords(id, query);
  }

  @Post('leads/:id/contacts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت سابقه تماس/تعامل جدید برای سرنخ' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ContactMessageResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سرنخ یافت نشد' })
  async addContactRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateContactRecordDto,
  ): Promise<ContactMessageResponseDto> {
    return this.crmService.addContactRecord(id, dto);
  }

  // ---------------------------------------------------------------------------
  // آمار تحلیلی
  // ---------------------------------------------------------------------------

  @Get('stats')
  @ApiOperation({
    summary: 'آمار ریالی فرصت‌های باز و نرخ تبدیل فروش',
    description:
      'ارزش پایپ‌لاین باز، درآمد تحقق‌یافته، نرخ تبدیل و تفکیک هر مرحله.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: LeadStatsResponseDto })
  async getStats(): Promise<LeadStatsResponseDto> {
    return this.crmService.getStats();
  }

  @Get('pipeline')
  @ApiOperation({ summary: 'پایپ‌لاین گروه‌بندی‌شده برای تابلوی کانبان' })
  @ApiResponse({ status: HttpStatus.OK, type: [PipelineStageGroupDto] })
  async getPipeline(): Promise<PipelineStageGroupDto[]> {
    return this.crmService.getPipeline();
  }
}
