import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ReportBuilderController } from './report-builder.routes';
import { ReportBuilderRepository } from './repositories/report-builder.repository';
import { ReportBuilderService } from './services/report-builder.service';

@Module({
  imports: [AccessModule],
  controllers: [ReportBuilderController],
  providers: [ReportBuilderRepository, ReportBuilderService],
  exports: [ReportBuilderService, ReportBuilderRepository],
})
export class ReportBuilderModule {}
