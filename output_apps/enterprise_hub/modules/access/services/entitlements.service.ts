import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessModule, SELLABLE_MODULES, dependenciesOf, dependentsOf, missingDependencies,
} from '../catalogue';
import { EntitlementsRepository } from '../repositories/entitlements.repository';
import { ModuleRequestsRepository } from '../repositories/module-requests.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { AccessContext } from '../access-context';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';

export interface EntitlementView {
  module: AccessModule;
  enabled: boolean;
}

export interface CatalogueEntry extends EntitlementView {
  dependsOn: AccessModule[];
  /** Why it is off, when it is: missing dependencies, or an open request. */
  requested: boolean;
}

type Req = Parameters<AuditService['record']>[0]['request'];

/** Which modules a tenant may use. Contains no pricing of any kind. */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly repo: EntitlementsRepository,
    private readonly requests: ModuleRequestsRepository,
    private readonly tenants: TenantsRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Trial switch: with ALL_MODULES_ENABLED=true (the default for the current trial) every
   * tenant sees every module. Turning it off needs no migration; the stored per-tenant
   * entitlements (all enabled for existing tenants) take over.
   */
  allEnabled(): boolean {
    return (this.config.get<string>('ALL_MODULES_ENABLED', 'true') ?? 'true').toLowerCase() !== 'false';
  }

  private async stored(tenantId: string): Promise<Map<string, boolean>> {
    return new Map((await this.repo.list(tenantId)).map((r) => [r.module, r.enabled]));
  }

  async list(tenantId: string): Promise<EntitlementView[]> {
    const rows = await this.stored(tenantId);
    const all = this.allEnabled();
    return SELLABLE_MODULES.map((module) => ({ module, enabled: all || rows.get(module) === true }));
  }

  /** What the "add modules" page shows: every sellable module, its state, dependencies and any open request. */
  async catalogue(tenantId: string): Promise<{ allEnabled: boolean; modules: CatalogueEntry[] }> {
    const [views, open] = await Promise.all([this.list(tenantId), this.requests.listForTenant(tenantId)]);
    const openModules = new Set(open.filter((r) => r.status === 'OPEN').map((r) => r.module));
    return {
      allEnabled: this.allEnabled(),
      modules: views.map((v) => ({ ...v, dependsOn: [...dependenciesOf(v.module)], requested: openModules.has(v.module) })),
    };
  }

  /** A tenant owner asks Roxira to enable a module (no purchase happens here). */
  async request(ctx: AccessContext, module: string, request?: Req): Promise<{ requested: true }> {
    if (!SELLABLE_MODULES.includes(module as AccessModule)) throw new BadRequestException('Unknown module.');
    const enabled = new Set((await this.list(ctx.tenantId)).filter((e) => e.enabled).map((e) => e.module));
    if (enabled.has(module as AccessModule)) throw new ConflictException('This module is already enabled.');
    if (await this.requests.openFor(ctx.tenantId, module)) throw new ConflictException('A request for this module is already open.');
    await this.requests.create({ tenantId: ctx.tenantId, module, requestedBy: ctx.userId });
    await this.audit.record({
      tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'entitlement.request',
      resourceType: 'module', resourceId: module, metadata: { needs: missingDependencies(module as AccessModule, enabled) }, request,
    });
    return { requested: true };
  }

  listOpenRequests() {
    return this.requests.listOpen();
  }

  /** Platform operator only (route is @Roles(ADMIN)); the target tenant is explicit by design. */
  async setForTenant(
    operatorUserId: string,
    tenantId: string,
    changes: Array<{ module: string; enabled: boolean }>,
    request?: Req,
  ): Promise<EntitlementView[]> {
    if (!(await this.tenants.findById(tenantId))) throw new NotFoundException('Organisation not found.');
    for (const c of changes) {
      if (!SELLABLE_MODULES.includes(c.module as AccessModule)) {
        throw new BadRequestException(`Unknown or non-sellable module: ${c.module}`);
      }
    }
    const state = await this.stored(tenantId);
    for (const c of changes) state.set(c.module, c.enabled);
    const on = new Set([...state].filter(([, v]) => v).map(([k]) => k));
    for (const c of changes) {
      const m = c.module as AccessModule;
      if (c.enabled) {
        const missing = missingDependencies(m, on);
        if (missing.length) throw new BadRequestException(`${m} needs ${missing.join(', ')} to be enabled first.`);
      } else {
        const blocking = dependentsOf(m).filter((d) => on.has(d));
        if (blocking.length) throw new BadRequestException(`${blocking.join(', ')} depend on ${m}; disable them first.`);
      }
    }
    for (const c of changes) {
      await this.repo.set(tenantId, c.module, c.enabled, operatorUserId);
      if (c.enabled) await this.requests.resolve(tenantId, c.module, 'DONE');
    }
    this.access.invalidateTenant(tenantId);
    await this.audit.record({
      tenantId, actorUserId: operatorUserId, action: 'entitlement.update',
      resourceType: 'tenant', resourceId: tenantId, metadata: { changes }, request,
    });
    return this.list(tenantId);
  }

  /** Modules a brand-new tenant starts with: env DEFAULT_TENANT_MODULES (comma list), default none. */
  async grantDefaults(tenantId: string): Promise<void> {
    const wanted = (this.config.get<string>('DEFAULT_TENANT_MODULES', '') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SELLABLE_MODULES.includes(s as AccessModule));
    for (const m of wanted) await this.repo.set(tenantId, m, true, null);
  }
}
