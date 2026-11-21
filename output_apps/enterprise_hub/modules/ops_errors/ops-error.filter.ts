import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { OpsErrorCaptureService } from './services/ops-error-capture.service';
import { safeRoute } from './ops-errors.util';

/**
 * Global filter: keeps Nest's default error response (it delegates to BaseExceptionFilter) and, for
 * 5xx and unhandled errors only, records a scrubbed event. 4xx are client mistakes and are skipped.
 * It reads only method, route pattern and tenant id from the request: never body, headers or query.
 */
@Catch()
export class OpsErrorFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly capture: OpsErrorCaptureService,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<{
        method?: string;
        url?: string;
        route?: { path?: string };
        user?: { tenantId?: string };
      }>();
      void this.capture.capture(exception, {
        route: safeRoute(req?.route?.path, req?.url),
        httpMethod: req?.method ?? null,
        status,
        tenantId: req?.user?.tenantId ?? null,
      });
    }
    super.catch(exception, host);
  }
}
