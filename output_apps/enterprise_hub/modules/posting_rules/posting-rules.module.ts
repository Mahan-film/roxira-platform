import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingRulesController } from './controllers/posting-rules.controller';
import { PostingRoleMapEntity } from './entities/posting-role-map.entity';
import { PostingSourceEntity } from './entities/posting-source.entity';
import { PostingRulesRepository } from './repositories/posting-rules.repository';
import { PostingRulesService } from './services/posting-rules.service';

/**
 * The posting rules engine: one template per document type, a per-tenant role -> account map,
 * balanced and idempotent vouchers. Depends only on AccountingModule (no cycle); other modules
 * import this one and call `PostingRulesService.post`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PostingRoleMapEntity, PostingSourceEntity]), AccountingModule],
  controllers: [PostingRulesController],
  providers: [PostingRulesService, PostingRulesRepository, TenantScope],
  exports: [PostingRulesService],
})
export class PostingRulesModule {}
