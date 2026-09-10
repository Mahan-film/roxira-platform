import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DamagesModule } from './modules/damages/damages.module';

/**
 * ماژول ریشه اپلیکیشن Enterprise Hub (NestJS).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - اتصال پایگاه‌داده (PostgreSQL/TypeORM) و صف Redis/BullMQ صرفاً در این
 *   ماژول ریشه پیکربندی می‌شوند؛ ماژول‌های فرزند (مثل DamagesModule) فقط
 *   Entity/Queue خود را از طریق forFeature/registerQueue معرفی می‌کنند.
 * - بدون هیچ import چرخه‌ای (Circular Dependency) بین ماژول‌ها.
 *
 * متغیرهای محیطی مورد استفاده (فایل .env در ریشه پروژه):
 *   DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD,
 *   DATABASE_NAME, VALKEY_URL (اتصال Redis/BullMQ)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER'),
        password: config.get<string>('DATABASE_PASSWORD'),
        database: config.get<string>('DATABASE_NAME'),
        autoLoadEntities: true,
        // مهاجرت‌های پایگاه‌داده باید صریح و کنترل‌شده اجرا شوند؛
        // synchronize هرگز در محیط Production فعال نمی‌شود.
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('VALKEY_URL', 'redis://localhost:6379'),
        },
      }),
    }),
    DamagesModule,
  ],
})
export class AppModule {}
