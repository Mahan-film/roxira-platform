import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartiesModule } from '../parties/parties.module';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { ContractsController } from './controllers/contracts.controller';
import { ProjectsController } from './controllers/projects.controller';
import { StatementsController } from './controllers/statements.controller';
import { ContractEntity } from './entities/contract.entity';
import { ProgressStatementEntity } from './entities/progress-statement.entity';
import { ProjectEntity } from './entities/project.entity';
import { ContractRepository } from './repositories/contract.repository';
import { ProjectRepository } from './repositories/project.repository';
import { StatementRepository } from './repositories/statement.repository';
import { ContractService } from './services/contract.service';
import { StatementService } from './services/statement.service';
import { ProjectService } from './services/project.service';

/** Contracting and project accounting (T3, #227): projects, contracts, then statements and retention. */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ContractEntity, ProgressStatementEntity]), PartiesModule, PostingRulesModule],
  controllers: [ProjectsController, ContractsController, StatementsController],
  providers: [ProjectService, ContractService, StatementService, ProjectRepository, ContractRepository, StatementRepository, TenantScope],
  exports: [ProjectService, ContractService, StatementService, ProjectRepository, ContractRepository, StatementRepository],
})
export class ContractingModule {}
