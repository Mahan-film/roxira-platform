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
        path.resolve(process.cwd(), '../../.env'),
        path.resolve(process.cwd(), '.env'),
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        let dbUrl = config.get<string>('DATABASE_URL');
        if (dbUrl && dbUrl.startsWith('postgres')) {
          dbUrl = dbUrl.replace('@postgres_prod:', '@127.0.0.1:');
          return {
            type: 'postgres',
            url: dbUrl,
            autoLoadEntities: true,
            synchronize: false,
          };
        }
        
        const host = config.get<string>('DATABASE_HOST', '127.0.0.1');
        return {
          type: 'postgres',
          host: host === 'postgres_prod' ? '127.0.0.1' : host,
          port: Number(config.get<number>('DATABASE_PORT', 5432)),
          username: config.get<string>('DATABASE_USER') || config.get<string>('POSTGRES_USER') || 'postgres',
          password: String(config.get<string>('DATABASE_PASSWORD') || config.get<string>('POSTGRES_PASSWORD') || ''),
          database: config.get<string>('DATABASE_NAME') || config.get<string>('POSTGRES_DB') || 'roxira_db',
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          connection: {
            host: '127.0.0.1',
            port: 6379,
          },
        };
      },
    }),
    DamagesModule,
  ],
})
export class AppModule {}
