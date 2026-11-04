import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CreateOpeningDraftDto,
  OpeningReviewDto,
  PostOpeningDto,
  ReplaceOpeningLinesDto,
} from '../dto/opening-balance.dto';
import { OpeningBalanceService } from '../services/opening-balance.service';

/**
 * Reviewed opening-balance flow: draft -> upload or edit lines -> review -> confirm -> post.
 * Posting needs the approve action; drafting and reviewing need create.
 */
@ApiTags('Inventory - موجودی اول دوره')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/openings')
export class OpeningBalanceController {
  constructor(private readonly openings: OpeningBalanceService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'فایل CSV کالاهای بدون موجودی برای تکمیل مقدار و بها' })
  template(@Req() request: AuthenticatedRequest): Promise<string> {
    return this.openings.template(requireTenantId(request));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'پیش‌نویس تازهٔ موجودی اول دوره' })
  @ApiResponse({ status: HttpStatus.CREATED, type: OpeningReviewDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateOpeningDraftDto): Promise<OpeningReviewDto> {
    return this.openings.createDraft(requireTenantId(request), this.userIdOf(request), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'بازبینی: جمع‌ها و همهٔ مشکلات سطرهای فعلی' })
  @ApiResponse({ status: HttpStatus.OK, type: OpeningReviewDto })
  review(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<OpeningReviewDto> {
    return this.openings.review(requireTenantId(request), id);
  }

  @Put(':id/lines')
  @ApiOperation({ summary: 'جایگزینی سطرهای پیش‌نویس (آپلود یا ویرایش)؛ بازبینی را پاک می‌کند' })
  @ApiResponse({ status: HttpStatus.OK, type: OpeningReviewDto })
  replaceLines(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceOpeningLinesDto,
  ): Promise<OpeningReviewDto> {
    return this.openings.replaceLines(requireTenantId(request), id, dto.lines);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید بازبینی سطرهای فعلی' })
  @ApiResponse({ status: HttpStatus.OK, type: OpeningReviewDto })
  markReviewed(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<OpeningReviewDto> {
    return this.openings.markReviewed(requireTenantId(request), this.userIdOf(request), id);
  }

  @RequireAction(AccessAction.APPROVE)
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ثبت نهایی موجودی اول دوره',
    description: 'تعداد سطر و جمع ارزشِ دیده‌شده در بازبینی باید تکرار شود؛ لایه‌های FIFO و سند حسابداری با هم ثبت می‌شوند.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: OpeningReviewDto })
  post(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PostOpeningDto,
  ): Promise<OpeningReviewDto> {
    return this.openings.post(requireTenantId(request), this.userIdOf(request), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف پیش‌نویس ثبت‌نشده' })
  async remove(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.openings.deleteDraft(requireTenantId(request), id);
  }
}
