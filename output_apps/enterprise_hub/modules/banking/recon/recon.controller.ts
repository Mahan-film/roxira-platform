import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { MAX_STATEMENT_BYTES } from './parse/statement-parser';
import {
  AnswerCheckDto,
  AnswerQuestionDto,
  ApproveDraftsDto,
  AuditQueryDto,
  ColumnMappingDto,
  CreateAccountFromSessionDto,
  DecideMatchDto,
  ListReportsQueryDto,
  ReportQueryDto,
  ReverseDraftDto,
  UpdateReconSettingsDto,
  UploadStatementQueryDto,
} from './recon.dto';
import { ReconService } from './recon.service';

interface UploadedStatement {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * Bank statement reconciliation assistant.
 *
 * The tenant comes only from the verified JWT and AccessGuard decides per route: preparing a
 * statement is `banking:create`, anything that confirms a match or touches the ledger is
 * `banking:post`, and settings, rules and the audit trail are `banking:admin`.
 */
@ApiTags('Banking - مغایرت‌گیری هوشمند صورتحساب')
@ModuleAccess(AccessModule.BANKING)
@Controller('enterprise-hub/banking/recon')
export class ReconController {
  constructor(private readonly recon: ReconService) {}

  private actor(request: AuthenticatedRequest): { tenantId: string; actor: string } {
    return { tenantId: requireTenantId(request), actor: request.user?.sub ?? 'unknown' };
  }

  // ---------------------------------------------------------------- settings

  @Get('settings')
  @ApiOperation({ summary: 'تنظیمات مغایرت‌گیری (سقف کارمزد، ثبت خودکار، پنجره تاریخ)' })
  settings(@Req() request: AuthenticatedRequest) {
    return this.recon.getSettings(this.actor(request).tenantId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('settings')
  @ApiOperation({ summary: 'ویرایش تنظیمات (مدیر سازمان)' })
  updateSettings(@Req() request: AuthenticatedRequest, @Body() dto: UpdateReconSettingsDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.updateSettings(tenantId, actor, dto);
  }

  // ---------------------------------------------------------------- sessions

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'بارگذاری صورتحساب (Excel/CSV/PDF) و بررسی پیش‌نیازها' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_BYTES } }))
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedStatement | undefined,
    @Query() query: UploadStatementQueryDto,
  ) {
    const { tenantId, actor } = this.actor(request);
    if (!file) {
      throw new BadRequestException('فایل صورتحساب ارسال نشده است.');
    }
    return this.recon.uploadStatement(tenantId, actor, file, query.bankAccountId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'فهرست صورتحساب‌های بارگذاری‌شده' })
  list(@Req() request: AuthenticatedRequest, @Query() query: ListReportsQueryDto) {
    return this.recon.listSessions(this.actor(request).tenantId, query.bankAccountId);
  }

  @Get('sessions/:id')
  session(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.recon.getSession(this.actor(request).tenantId, id);
  }

  @Post('sessions/:id/mapping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'نگاشت ستون‌ها برای قالب ناشناخته' })
  mapping(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ColumnMappingDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.submitMapping(tenantId, actor, id, dto.columnMap);
  }

  @Post('sessions/:id/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پاسخ به یک پرسش پیش‌نیاز (تأیید حساب، هم‌پوشانی، مانده …)' })
  answerCheck(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: AnswerCheckDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.answerCheck(tenantId, actor, id, dto.code, dto.choice);
  }

  @Post('sessions/:id/create-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ساخت حساب بانکی جدید از مشخصات فایل' })
  createAccount(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateAccountFromSessionDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.createAccountFromSession(tenantId, actor, id, dto);
  }

  @Post('sessions/:id/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت ردیف‌ها، تطبیق با دفتر، طبقه‌بندی و ساخت پیش‌نویس' })
  commit(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.commit(tenantId, actor, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('sessions/:id/rematch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اجرای دوباره تطبیق (پس از ثبت اسناد جدید)' })
  rematch(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.rerun(tenantId, actor, id);
  }

  @Get('sessions/:id/review')
  @ApiOperation({ summary: 'تطبیق‌خورده، پیشنهادی، بدون تطبیق و پرسش‌ها' })
  review(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.recon.getReview(this.actor(request).tenantId, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('sessions/:id/matches/:groupId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پذیرش یا رد تطبیق پیشنهادی' })
  decide(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId') groupId: string,
    @Body() dto: DecideMatchDto,
  ) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.decideMatch(tenantId, actor, id, groupId.slice(0, 40), dto.accept);
  }

  @Post('sessions/:id/report')
  @ApiOperation({ summary: 'ساخت صورت مغایرت بانکی این دوره' })
  report(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.buildReport(tenantId, actor, id).then(({ id: reportId, report }) => ({ id: reportId, report }));
  }

  // ------------------------------------------------------------------- items

  @Post('items/:id/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پاسخ به پرسش طبقه‌بندی یک ردیف (قانون ماندگار + پیش‌نویس)' })
  answer(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: AnswerQuestionDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.answerQuestion(tenantId, actor, id, dto);
  }

  @Post('items/:id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'پیوست سند به یک ردیف' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  attach(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: UploadedStatement | undefined) {
    const { tenantId, actor } = this.actor(request);
    if (!file) {
      throw new BadRequestException('فایل ارسال نشده است.');
    }
    return this.recon.attachDocument(tenantId, actor, id, file);
  }

  // ------------------------------------------------------------------ drafts

  @RequireAction(AccessAction.POST)
  @Post('drafts/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید دسته‌ای پیش‌نویس‌ها و ثبت سند' })
  approve(@Req() request: AuthenticatedRequest, @Body() dto: ApproveDraftsDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.approveDrafts(tenantId, actor, dto.draftIds);
  }

  @RequireAction(AccessAction.POST)
  @Post('drafts/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.rejectDraft(tenantId, actor, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('drafts/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اصلاح فقط با سند معکوس' })
  reverse(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReverseDraftDto) {
    const { tenantId, actor } = this.actor(request);
    return this.recon.reverseDraft(tenantId, actor, id, dto.reason);
  }

  // ----------------------------------------------------------- rules, reports

  @Get('rules')
  rules(@Req() request: AuthenticatedRequest) {
    return this.recon.listRules(this.actor(request).tenantId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, actor } = this.actor(request);
    await this.recon.deleteRule(tenantId, actor, id);
  }

  @Get('reports')
  @ApiOperation({ summary: 'تاریخچه صورت مغایرت هر دوره' })
  reports(@Req() request: AuthenticatedRequest, @Query() query: ListReportsQueryDto) {
    return this.recon.listReports(this.actor(request).tenantId, query.bankAccountId);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('reports/:id')
  @ApiOperation({ summary: 'دریافت صورت مغایرت (json، xlsx، csv یا html برای چاپ/PDF)' })
  async exportReport(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReportQueryDto,
    @Res() response: Response,
  ) {
    const file = await this.recon.exportReport(this.actor(request).tenantId, id, query.format ?? 'json');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.body);
  }

  @RequireAction(AccessAction.ADMIN)
  @Get('audit')
  audit(@Req() request: AuthenticatedRequest, @Query() query: AuditQueryDto) {
    return this.recon.listAudit(this.actor(request).tenantId, query.subjectType, query.subjectId);
  }
}
