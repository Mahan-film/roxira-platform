import 'reflect-metadata';
import { AccessModule } from '../access/access.module';
import { AuditService } from '../access/services/audit.service';
import { TenantScope } from '../access/services/tenant-scope';
import { ApprovalsModule } from './approvals.module';
import { ApprovalsController } from './controllers/approvals.controller';
import { ApprovalsRepository } from './repositories/approvals.repository';

/**
 * ApprovalsModule is imported by app.module.ts, so its providers must resolve on their own:
 * ApprovalsRepository needs TenantScope (AccessModule does not export it) and ApprovalsService
 * needs AuditService (AccessModule exports it).
 */
describe('ApprovalsModule wiring', () => {
  const meta = (key: string, target: object): unknown[] => Reflect.getMetadata(key, target) ?? [];

  it('provides TenantScope for the repository and gets AuditService from AccessModule', () => {
    expect(meta('providers', ApprovalsModule)).toEqual(expect.arrayContaining([TenantScope, ApprovalsRepository]));
    expect(meta('imports', ApprovalsModule)).toContain(AccessModule);
    expect(meta('exports', AccessModule)).toContain(AuditService);
  });

  it('serves the controller from controllers/approvals.controller.ts so the permission matrix scans it', () => {
    expect(meta('controllers', ApprovalsModule)).toContain(ApprovalsController);
  });
});
