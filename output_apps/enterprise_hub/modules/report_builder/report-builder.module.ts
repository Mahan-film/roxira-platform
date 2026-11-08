import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TenantScope } from '../access/services/tenant-scope';
import { ReportBuilderController } from './controllers/report-builder.controller';
import { ReportBuilderRepository } from './repositories/report-builder.repository';
import { ReportBuilderService } from './services/report-builder.service';

@Module({
  imports: [AccessModule],
  controllers: [ReportBuilderController],
  providers: [TenantScope, ReportBuilderRepository, ReportBuilderService],
  exports: [ReportBuilderService, ReportBuilderRepository],
})
export class ReportBuilderModule {}
