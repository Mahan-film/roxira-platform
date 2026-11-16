import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { TenantsModule } from '../tenants/tenants.module';
import { OnboardingController } from './controllers/onboarding.controller';
import { TenantOnboardingProgressEntity } from './entities/tenant-onboarding-progress.entity';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { OnboardingService } from './services/onboarding.service';

/**
 * New-company setup wizard (T96). Depends on TenantsModule (renaming the organisation) and
 * provides TenantScope itself, as AccessModule does not export it. Nothing imports this module
 * back, so there is no cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantOnboardingProgressEntity]), TenantsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingRepository, TenantScope],
})
export class OnboardingModule {}
