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
        path.resolve(process.cwd(), '.env'),
        path.resolve('/opt/roxira_platform/.env'),
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.get<string>('DATABASE_URL');
        if (dbUrl && dbUrl.startsWith('postgres')) {
          return {
            type: 'postgres',
            url: dbUrl,
            autoLoadEntities: true,
            synchronize: false,
          };
        }
        return {
          type: 'postgres',
          host: config.get<string>('DATABASE_HOST', '127.0.0.1'),
          port: Number(config.get<number>('DATABASE_PORT', 5432)),
          username: config.get<string>('DATABASE_USER', 'postgres'),
          password: String(config.get<string>('DATABASE_PASSWORD', config.get<string>('POSTGRES_PASSWORD', ''))),
          database: config.get<string>('DATABASE_NAME', 'roxira_db'),
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const rawUrl = config.get<string>('VALKEY_URL', 'redis://127.0.0.1:6379');
        try {
          const parsed = new URL(rawUrl);
          return {
            connection: {
              host: parsed.hostname || '127.0.0.1',
              port: Number(parsed.port) || 6379,
              password: parsed.password || undefined,
            },
          };
        } catch {
          return {
            connection: {
              host: '127.0.0.1',
              port: 6379,
            },
          };
        }
      },
    }),
    DamagesModule,
  ],
})
export class AppModule {}
