import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthServiceDomain } from '../enums/auth-service.enum';

/** محتوای توکن JWT امضاشده توسط AuthService. */
export interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
  domain: AuthServiceDomain;
  iat?: number;
  exp?: number;
}

/** کاربر احراز‌هویت‌شده که روی Request قرار می‌گیرد. */
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * گارد احراز هویت مبتنی بر توکن JWT.
 * هدر `Authorization: Bearer <token>` را بررسی و پیلود را روی Request
 * قرار می‌دهد تا کنترلرهای محافظت‌شده به هویت کاربر دسترسی داشته باشند.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers?.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('هدر احراز هویت (Bearer Token) یافت نشد.');
    }

    const token = header.slice('Bearer '.length).trim();

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است.');
    }
  }
}
