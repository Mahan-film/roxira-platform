import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { TenantScope } from '../../access/services/tenant-scope';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

/**
 * Tenant policy settings (#585). Imports AccessModule for the AuditService; provides its own
 * TenantScope (the policy tables run under FORCE row-level security). It never imports the inventory
 * or accounting modules, so the two price-tolerance keys are written with raw SQL, not through
 * PurchaseRepository (that would close a module cycle).
 */
@Module({
  imports: [AccessModule],
  controllers: [PolicyController],
  providers: [TenantScope, PolicyService],
  exports: [PolicyService],
})
export class TenantPolicyModule {}
