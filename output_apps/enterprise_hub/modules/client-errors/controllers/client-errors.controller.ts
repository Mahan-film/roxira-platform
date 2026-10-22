import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/public.decorator';
import { CLIENT_ERRORS_RESOURCE, CLIENT_ERRORS_THROTTLE } from '../constants/client-errors.constants';
import { ReportClientErrorDto } from '../dto/report-client-error.dto';
import { ClientErrorsService } from '../services/client-errors.service';

/** `POST /v1/enterprise-hub/client-errors`: عمومی، با محدودیت نرخ؛ فقط مسیریابی HTTP. */
@ApiTags('Client errors')
@Controller(CLIENT_ERRORS_RESOURCE)
export class ClientErrorsController {
  constructor(private readonly clientErrorsService: ClientErrorsService) {}

  @Public()
  @Throttle({ default: CLIENT_ERRORS_THROTTLE })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'گزارش خطای مرورگر (بدون توکن/PII)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'محدودیت نرخ' })
  async report(@Body() dto: ReportClientErrorDto): Promise<void> {
    await this.clientErrorsService.report(dto);
  }
}
