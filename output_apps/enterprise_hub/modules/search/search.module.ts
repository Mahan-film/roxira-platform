import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TenantScope } from '../access/services/tenant-scope';
import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';

@Module({
  imports: [AccessModule],
  controllers: [SearchController],
  providers: [TenantScope, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
