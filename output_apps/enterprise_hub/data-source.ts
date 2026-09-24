import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * دیتاسورس مستقل جهت اجرای TypeORM CLI (migration:run / migration:revert / migration:generate).
 * این فایل صرفاً برای عملیات Migration استفاده می‌شود و مستقل از AppModule است
 * (Rule #2.4 AGENTS.md - Contract-First Synchronization پیش از تغییرات پایگاه‌داده).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 5432,
  username: process.env.DATABASE_USER || 'enterprise_admin',
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME || 'enterprise_db',
  entities: ['modules/**/*.entity{.ts,.js}'],
  migrations: ['migrations/*{.ts,.js}'],
  synchronize: false,
  logging: false,
});
