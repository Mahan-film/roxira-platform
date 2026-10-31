import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AccessRequest } from './access-context';
import { AuditService } from './services/audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every mutating request that passed the AccessGuard (who, which route,
 * outcome). Bodies are never stored. Semantic events (role changed, member
 * removed, ...) are recorded separately by the services.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AccessRequest>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    if (!MUTATING.has(request.method) || !request.access) {
      return next.handle();
    }
    const ctx = request.access;
    const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
    const write = (status: number) =>
      void this.audit.record({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: `http.${request.method}`,
        resourceType: 'route',
        resourceId: String(route).slice(0, 80),
        metadata: { status, role: ctx.roleKey },
        request,
      });
    return next.handle().pipe(
      tap({
        next: () => write(response.statusCode),
        error: (err: { status?: number; getStatus?: () => number }) =>
          write(typeof err?.getStatus === 'function' ? err.getStatus() : (err?.status ?? 500)),
      }),
    );
  }
}
