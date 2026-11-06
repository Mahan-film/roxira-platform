import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { HrModule } from '../hr/hr.module';
import { PartiesModule } from '../parties/parties.module';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { ContractsController } from './controllers/contracts.controller';
import { ProjectsController } from './controllers/projects.controller';
import { MovementsController } from './controllers/movements.controller';
import { StatementsController } from './controllers/statements.controller';
import { ContractEntity } from './entities/contract.entity';
import { ContractMovementEntity } from './entities/contract-movement.entity';
import { ProgressStatementEntity } from './entities/progress-statement.entity';
import { ProjectEntity } from './entities/project.entity';
import { ContractRepository } from './repositories/contract.repository';
import { ProjectRepository } from './repositories/project.repository';
import { MovementRepository } from './repositories/movement.repository';
import { StatementRepository } from './repositories/statement.repository';
import { ContractService } from './services/contract.service';
import { MovementService } from './services/movement.service';
import { StatementService } from './services/statement.service';
import { ProjectService } from './services/project.service';

/** Contracting and project accounting (T3, #227): projects, contracts, then statements and retention. */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ContractEntity, ProgressStatementEntity, ContractMovementEntity]), PartiesModule, PostingRulesModule, HrModule],
  controllers: [ProjectsController, ContractsController, StatementsController, MovementsController],
  providers: [ProjectService, ContractService, StatementService, MovementService, MovementRepository, ProjectRepository, ContractRepository, StatementRepository, TenantScope],
  exports: [ProjectService, ContractService, StatementService, MovementService, MovementRepository, ProjectRepository, ContractRepository, StatementRepository],
})
export class ContractingModule {}
