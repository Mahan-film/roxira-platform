import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiScope } from '../constants/public-api.constants';
import { ApiRateLimiter } from '../services/api-rate-limiter';
import { ApiPrincipal, ApiTokensService } from '../services/api-tokens.service';

export const API_SCOPE_KEY = 'roxira:apiScope';
/** Handler decorator: the token must carry this scope. */
export const RequireScope = (scope: ApiScope): MethodDecorator => SetMetadata(API_SCOPE_KEY, scope);

export interface ApiRequest extends Request {
  apiPrincipal?: ApiPrincipal;
}

/**
 * Authenticates `Authorization: Bearer rxk_...` for `/api/v1`. Controllers using it are `@Public()`
 * (they skip the JWT guards) and must declare `@RequireScope(...)` on every handler; a handler
 * without a scope is refused (default deny). The tenant comes only from the stored token.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: ApiTokensService,
    private readonly limiter: ApiRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'unauthorized', message: 'Authorization: Bearer <token> is required.' });
    }
    const principal = await this.tokens.authenticate(header.slice(7).trim());
    if (!principal) {
      throw new UnauthorizedException({ error: 'invalid_token', message: 'The token is invalid, revoked or expired.' });
    }

    const decision = await this.limiter.hit(principal.tokenId, principal.rateLimitPerMinute);
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException({ error: 'rate_limited', message: 'Too many requests for this token.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const scope = this.reflector.get<ApiScope | undefined>(API_SCOPE_KEY, context.getHandler());
    if (!scope) {
      throw new ForbiddenException({ error: 'no_scope_policy', message: 'This route has no scope policy.' });
    }
    if (!principal.scopes.includes(scope)) {
      throw new ForbiddenException({ error: 'insufficient_scope', message: `The token lacks the ${scope} scope.` });
    }
    req.apiPrincipal = principal;
    return true;
  }
}
