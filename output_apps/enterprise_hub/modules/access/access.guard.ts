import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { AccessContext, AccessRequest } from './access-context';
import { denied } from './access-errors';
import {
  AccessAction,
  AccessModule,
  SensitiveField,
  requiredFieldForHandler,
} from './catalogue';
import {
  ACCESS_ACTION_KEY,
  ACCESS_ALSO_KEY,
  ACCESS_FIELD_KEY,
  ACCESS_MODULE_KEY,
  ANY_MEMBER_KEY,
  AUTH_ONLY_KEY,
  actionForMethod,
} from './decorators';
import { decisionToError, evaluateWithShadow } from './policy-evaluator';
import { AccessService } from './services/access.service';

/**
 * The one authorisation guard for every suite endpoint (runs after JwtAuthGuard
 * and RolesGuard). Default deny: a route must be @Public, @AuthOnly, @Roles or
 * belong to a module via @ModuleAccess, otherwise it is refused.
 *
 * The JWT only *selects* the organisation. Membership, role permissions,
 * module entitlement, field visibility, scope/amount limits and the 2FA policy
 * are all re-read from the database, and `request.user.tenantId/tenantRole`
 * are overwritten with the verified values, so downstream `requireTenantId()`
 * can never see a forged claim.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccessRequest>();
    const user = request.user;
    if (!user?.sub) {
      throw new UnauthorizedException('Authentication required.');
    }

    // Old tokens (issued before sessions existed) carry no sid; they die with their short expiry.
    if (user.sid && !(await this.access.isSessionActive(user.sid, user.sub))) {
      throw new UnauthorizedException('Session ended. Please sign in again.');
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(AUTH_ONLY_KEY, targets)) {
      return true;
    }
    // Platform-operator routes: RolesGuard already enforced the global role.
    const platformRoles = this.reflector.getAllAndOverride<unknown[] | undefined>(ROLES_KEY, targets);
    if (platformRoles && platformRoles.length > 0) {
      return true;
    }

    const anyMember = this.reflector.getAllAndOverride<boolean | undefined>(ANY_MEMBER_KEY, targets) === true;
    const module = this.reflector.getAllAndOverride<AccessModule | undefined>(ACCESS_MODULE_KEY, targets);
    if (!module && !anyMember) {
      this.logger.error(
        `[ACCESS] no access policy on ${request.method} ${request.originalUrl ?? request.url}; refusing`,
      );
      throw denied('NO_ACCESS_POLICY', 'This route has no access policy.');
    }

    if (!user.tenantId) {
      throw denied('NO_ORGANISATION', 'Your account is not part of an organisation yet.');
    }
    const ctx = await this.access.resolve(user.sub, user.tenantId);
    if (!ctx) {
      throw denied('NOT_A_MEMBER', 'You are not an active member of this organisation.');
    }

    if (module && !anyMember) {
      const handler = context.getHandler();
      const controller = context.getClass();
      const action =
        this.reflector.getAllAndOverride<AccessAction | undefined>(ACCESS_ACTION_KEY, [handler]) ??
        actionForMethod(request.method);
      const also = this.reflector.getAllAndOverride<AccessModule[] | undefined>(ACCESS_ALSO_KEY, [
        handler,
      ]);
      const field =
        this.reflector.getAllAndOverride<SensitiveField | undefined>(ACCESS_FIELD_KEY, targets) ??
        requiredFieldForHandler(controller?.name ?? '', handler?.name ?? '');

      const shadowEnabled = process.env.ACCESS_SHADOW_MODE === 'true';
      const decision = evaluateWithShadow(
        ctx,
        { module, also, action, field },
        shadowEnabled
          ? (diff) =>
              this.logger.warn(
                `[ACCESS_SHADOW] ${controller?.name}.${handler?.name} role=${diff.roleKey} legacy=${diff.legacyAllowed} next=${diff.newAllowed} code=${diff.newCode ?? 'OK'}`,
              )
          : undefined,
        shadowEnabled,
      );
      const denial = decisionToError(decision);
      if (denial) throw denial;
    }

    if (ctx.require2fa && !user.mfa) {
      throw denied('MFA_REQUIRED', 'Your organisation requires two-factor sign-in.');
    }

    this.bind(request, ctx);
    return true;
  }

  private bind(request: AccessRequest, ctx: AccessContext): void {
    request.access = ctx;
    if (request.user) {
      request.user.tenantId = ctx.tenantId;
      request.user.tenantRole = ctx.roleKey === 'owner' ? TenantRole.OWNER : TenantRole.MEMBER;
    }
  }
}
