import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DamagesModule } from './modules/damages/damages.module';

// بارگذاری قطعی متغیرهای ریشه سرور
dotenv.config({ path: path.resolve('/opt/roxira_platform/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const dbHost = process.env.DATABASE_HOST || '127.0.0.1';
const dbPort = Number(process.env.DATABASE_PORT || 5432);
const dbUser = process.env.DATABASE_USER || process.env.POSTGRES_USER || 'postgres';
const dbPass = process.env.DATABASE_PASSWORD || process.env.POSTGRES_PASSWORD || '';
const dbName = process.env.DATABASE_NAME || process.env.POSTGRES_DB || 'roxira_db';
const dbUrl = process.env.DATABASE_URL;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(
      dbUrl && dbUrl.startsWith('postgres')
        ? {
            type: 'postgres',
            url: dbUrl,
            autoLoadEntities: true,
            synchronize: false,
          }
        : {
            type: 'postgres',
            host: dbHost === 'postgres_prod' ? '127.0.0.1' : dbHost,
            port: dbPort,
            username: dbUser,
            password: dbPass,
            database: dbName,
            autoLoadEntities: true,
            synchronize: false,
          },
    ),
    BullModule.forRoot({
      connection: {
        host: '127.0.0.1',
        port: 6379,
      },
    }),
    DamagesModule,
  ],
})
export class AppModule {}
