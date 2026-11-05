import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartiesModule } from '../parties/parties.module';
import { ContractsController } from './controllers/contracts.controller';
import { ProjectsController } from './controllers/projects.controller';
import { ContractEntity } from './entities/contract.entity';
import { ProjectEntity } from './entities/project.entity';
import { ContractRepository } from './repositories/contract.repository';
import { ProjectRepository } from './repositories/project.repository';
import { ContractService } from './services/contract.service';
import { ProjectService } from './services/project.service';

/** Contracting and project accounting (T3, #227): projects, contracts, then statements and retention. */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ContractEntity]), PartiesModule],
  controllers: [ProjectsController, ContractsController],
  providers: [ProjectService, ContractService, ProjectRepository, ContractRepository, TenantScope],
  exports: [ProjectService, ContractService, ProjectRepository, ContractRepository],
})
export class ContractingModule {}
