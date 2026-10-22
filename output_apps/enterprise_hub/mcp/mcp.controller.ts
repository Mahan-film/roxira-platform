import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedRequest } from '../modules/auth/guards/jwt-auth.guard';
import { requireTenantId } from '../modules/tenants/tenant-context';
import { McpHttpHandler } from './mcp-http.handler';

/**
 * نقطه پایانی MCP روی بک‌اند NestJS (انتقال Streamable HTTP).
 *
 * مسیر `enterprise-hub/mcp` با گارد سراسری `JwtAuthGuard` محافظت می‌شود و
 * شناسه مستأجر «تنها» از پیلود تأییدشده JWT استخراج می‌گردد
 * (`requireTenantId`)؛ هرگز از بدنه/کوئری/هدر (Rule #4 - AGENTS.md).
 *
 * در MCP، پیام‌های JSON-RPC با POST ارسال می‌شوند؛ GET/DELETE در حالت
 * stateless پشتیبانی نمی‌شوند و ۴۰۵ برمی‌گردانند.
 */
@ApiTags('MCP - پروتکل زمینه مدل (ابزارهای سازمانی)')
@ApiBearerAuth()
@Controller('enterprise-hub/mcp')
export class McpController {
  constructor(private readonly handler: McpHttpHandler) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'دریافت پیام‌های JSON-RPC پروتکل MCP',
    description:
      'ابزارهای خواندنی و پیشنهادی سازمانی را برای ایجنت‌های مجاز (Bearer JWT) فراهم می‌کند.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'نتیجه اجرای ابزار' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'توکن نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'کاربر بدون سازمان' })
  async handlePost(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    requireTenantId(request);
    await this.handler.handle(request, response);
  }

  @Get()
  @ApiOperation({ summary: 'استریم SSE (در حالت stateless پشتیبانی نمی‌شود)' })
  @ApiResponse({ status: HttpStatus.METHOD_NOT_ALLOWED })
  handleGet(@Res() response: Response): void {
    response.status(HttpStatus.METHOD_NOT_ALLOWED).json(
      McpHttpHandler.methodNotAllowed(),
    );
  }

  @Delete()
  @ApiOperation({ summary: 'پایان session (در حالت stateless پشتیبانی نمی‌شود)' })
  @ApiResponse({ status: HttpStatus.METHOD_NOT_ALLOWED })
  handleDelete(@Res() response: Response): void {
    response.status(HttpStatus.METHOD_NOT_ALLOWED).json(
      McpHttpHandler.methodNotAllowed(),
    );
  }
}
