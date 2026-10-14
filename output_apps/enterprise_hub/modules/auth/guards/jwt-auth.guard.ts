import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthServiceDomain } from '../enums/auth-service.enum';

/** محتوای توکن JWT امضاشده توسط AuthService. */
export interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
  domain: AuthServiceDomain;
  /**
   * شناسه سازمان کاربر یا null. اختیاری است تا توکن‌های قدیمی که این claim را
   * ندارند همچنان معتبر بمانند و در آن‌ها مقدار null در نظر گرفته شود.
   */
  tenantId?: string | null;
  /** نقش کاربر درون سازمان یا null (برای توکن‌های قدیمی: null). */
  tenantRole?: string | null;
  iat?: number;
  exp?: number;
}

/** کاربر احراز‌هویت‌شده که روی Request قرار می‌گیرد. */
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * گارد احراز هویت مبتنی بر توکن JWT (سراسری از طریق APP_GUARD؛ مسیرهای
 * `@Public()` مستثنی هستند).
 * هدر `Authorization: Bearer <token>` را بررسی و پیلود را روی Request
 * قرار می‌دهد تا کنترلرهای محافظت‌شده به هویت کاربر دسترسی داشته باشند.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers?.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('هدر احراز هویت (Bearer Token) یافت نشد.');
    }

    const token = header.slice('Bearer '.length).trim();

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
      });
      return true;
    } catch {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است.');
    }
  }
}
