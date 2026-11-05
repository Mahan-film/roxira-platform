import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartiesController } from './controllers/parties.controller';
import { PartyEntity } from './entities/party.entity';
import { PartiesRepository } from './repositories/parties.repository';
import { PartiesService } from './services/parties.service';

/**
 * Party master: customers and suppliers keyed by a per-tenant code. Standalone on purpose — it
 * imports nothing from crm, treasury, accounting or data_import, so any module (including the
 * importer) can consume `PartiesService` without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PartyEntity])],
  controllers: [PartiesController],
  providers: [PartiesService, PartiesRepository, TenantScope],
  exports: [PartiesService],
})
export class PartiesModule {}
