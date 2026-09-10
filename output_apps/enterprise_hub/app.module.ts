import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as path from 'path';
import { DamagesModule } from './modules/damages/damages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve('/opt/roxira_platform/.env'),
        path.resolve(process.cwd(), '.env'),
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: '127.0.0.1',
        port: Number(config.get<number>('DATABASE_PORT', 5432)),
        username: config.get<string>('DATABASE_USER') || config.get<string>('POSTGRES_USER') || 'enterprise_admin',
        password: String(config.get<string>('DATABASE_PASSWORD') || config.get<string>('POSTGRES_PASSWORD') || 'REDACTED_SECRET_19'),
        database: config.get<string>('DATABASE_NAME') || config.get<string>('POSTGRES_DB') || 'enterprise_db',
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: '127.0.0.1',
          port: 6379,
        },
      }),
    }),
    DamagesModule,
  ],
})
export class AppModule {}
