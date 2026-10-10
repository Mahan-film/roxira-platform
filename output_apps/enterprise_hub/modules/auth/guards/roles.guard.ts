import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * گارد نقش‌ها؛ پس از JwtAuthGuard اجرا می‌شود. اگر مسیر @Roles نداشته باشد
 * عبور می‌دهد، در غیر این صورت نقش درون توکن امضاشده باید مجاز باشد.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role || !required.includes(role as UserRole)) {
      throw new ForbiddenException('دسترسی شما به این مسیر مجاز نیست.');
    }
    return true;
  }
}
