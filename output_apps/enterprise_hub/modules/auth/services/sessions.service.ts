import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../../access/services/access.service';
import { AuditService } from '../../access/services/audit.service';
import { MembershipsRepository } from '../../access/repositories/memberships.repository';
import { AuthRepository } from '../repositories/auth.repository';
import { RefreshTokenService } from './refresh-token.service';

export interface SessionView {
  id: string;
  current: boolean;
  device: string;
  ip: string | null;
  startedAt: Date | null;
  lastUsedAt: Date;
  mfa: boolean;
  tenantId: string | null;
}

/** Short human label from a User-Agent ("Chrome on macOS"); never trusted for decisions. */
export function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

type Req = Parameters<AuditService['record']>[0]['request'];

/** The signed-in user's own sessions and active-organisation switching. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly tokens: RefreshTokenService,
    private readonly memberships: MembershipsRepository,
    private readonly users: AuthRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, currentSid?: string): Promise<SessionView[]> {
    return (await this.tokens.listActive(userId)).map((r) => ({
      id: r.familyId,
      current: r.familyId === currentSid,
      device: describeDevice(r.userAgent),
      ip: r.ip,
      startedAt: r.sessionStartedAt,
      lastUsedAt: r.createdAt,
      mfa: r.mfa,
      tenantId: r.tenantId,
    }));
  }

  async revoke(userId: string, sessionId: string, tenantId: string | null | undefined, request?: Req): Promise<void> {
    if (!(await this.tokens.revokeSession(userId, sessionId))) throw new NotFoundException('Session not found.');
    this.access.invalidateUser(userId);
    await this.audit.record({ tenantId: tenantId ?? null, actorUserId: userId, action: 'session.revoke', resourceType: 'session', resourceId: sessionId, request });
  }

  async revokeOthers(userId: string, currentSid: string | undefined, tenantId: string | null | undefined, request?: Req): Promise<{ revoked: number }> {
    if (!currentSid) throw new ForbiddenException('This token has no session; sign in again first.');
    const revoked = await this.tokens.revokeOthers(userId, currentSid);
    this.access.invalidateUser(userId);
    await this.audit.record({ tenantId: tenantId ?? null, actorUserId: userId, action: 'session.revoke_others', metadata: { revoked }, request });
    return { revoked };
  }

  /** Organisations the user belongs to (active memberships of active tenants). */
  listOrganizations(userId: string) {
    return this.memberships.listForUser(userId, userId);
  }

  /** Verify membership server-side, then re-point this session; the caller signs a new access token. */
  async switchTenant(userId: string, sid: string | undefined, tenantId: string, request?: Req): Promise<void> {
    const m = await this.memberships.findByTenantUser(tenantId, userId);
    if (!m || m.status !== 'ACTIVE') throw new ForbiddenException('You are not a member of that organisation.');
    if (sid) await this.tokens.setSessionTenant(userId, sid, tenantId);
    const user = await this.users.findById(userId, { callerUserId: userId });
    if (user) {
      user.tenantId = tenantId;
      user.tenantRole = m.roleKey === 'owner' ? ('OWNER' as never) : ('MEMBER' as never);
      await this.users.save(user);
    }
    await this.audit.record({ tenantId, actorUserId: userId, action: 'session.switch_tenant', request });
  }
}
