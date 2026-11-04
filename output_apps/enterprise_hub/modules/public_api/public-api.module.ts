import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { TenantScope } from '../access/services/tenant-scope';
import { PUBLIC_API_REDIS } from './constants/public-api.constants';
import { ApiTokensController } from './controllers/api-tokens.controller';
import { ApiTokenEntity } from './entities/api-token.entity';
import { ApiTokenGuard } from './guards/api-token.guard';
import { ApiTokensRepository } from './repositories/api-tokens.repository';
import { ApiRateLimiter } from './services/api-rate-limiter';
import { ApiTokensService } from './services/api-tokens.service';

/**
 * Public API: tenant API tokens (this module), `/api/v1` endpoints and outgoing webhooks follow.
 * Depends on other suite modules only through their exported service methods.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ApiTokenEntity])],
  controllers: [ApiTokensController],
  providers: [
    TenantScope,
    ApiTokensRepository,
    ApiTokensService,
    ApiRateLimiter,
    ApiTokenGuard,
    {
      provide: PUBLIC_API_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: 3,
        }),
    },
  ],
  exports: [ApiTokensService, ApiTokenGuard],
})
export class PublicApiModule {}
