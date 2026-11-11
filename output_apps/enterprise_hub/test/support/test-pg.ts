import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { TenantScope } from '../../modules/access/services/tenant-scope';

export const PG_HOST = process.env.ROXIRA_TEST_PG_HOST;
export const PG_PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
export const describePg = PG_HOST ? describe : describe.skip;

export const ADMIN_USER = process.env.ROXIRA_TEST_PG_ADMIN_USER ?? 'postgres';
export const ADMIN_PASSWORD = process.env.ROXIRA_TEST_PG_ADMIN_PASSWORD ?? process.env.ROXIRA_TEST_PG_PASSWORD;

// The app role defaults to roxira_app (NOSUPERUSER NOBYPASSRLS).
export const APP_USER =
  process.env.ROXIRA_TEST_PG_APP_USER ??
  (process.env.ROXIRA_TEST_PG_USER && process.env.ROXIRA_TEST_PG_USER !== 'postgres'
    ? process.env.ROXIRA_TEST_PG_USER
    : 'roxira_app');
export const APP_PASSWORD = process.env.ROXIRA_TEST_PG_APP_PASSWORD ?? 'app-role-test-only';

export const PGB_HOST = process.env.ROXIRA_TEST_PGB_HOST ?? PG_HOST;
export const PGB_PORT = process.env.ROXIRA_TEST_PGB_PORT ? Number(process.env.ROXIRA_TEST_PGB_PORT) : PG_PORT;

export const TEST_T1 = '11111111-1111-4111-8111-111111111111';
export const TEST_T2 = '22222222-2222-4222-8222-222222222222';

export const MIGRATIONS_PATH = path.join(__dirname, '../../migrations/*.ts');
export const ENTITIES_PATH = path.join(__dirname, '../../modules/**/*.entity.ts');

export const makePgOptions = (
  database: string,
  username = ADMIN_USER,
  password: string | undefined = ADMIN_PASSWORD,
  host = PG_HOST,
  port = PG_PORT,
  extraOverrides?: Partial<DataSourceOptions>,
): DataSourceOptions => ({
  type: 'postgres' as const,
  host,
  port,
  username,
  password: typeof password === 'string' ? password : (password as any),
  database,
  entities: [ENTITIES_PATH],
  migrations: [MIGRATIONS_PATH],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
  ...(extraOverrides as any),
});

export interface TestDatabaseContext {
  dbName: string;
  admin: DataSource;
  owner: DataSource;
  app: DataSource;
  scope: TenantScope;
  rawQuery: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(
  prefix: string,
  extraOptions?: Partial<DataSourceOptions>,
): Promise<TestDatabaseContext> {
  const dbName = `rx_${prefix}_${process.pid}_${Date.now()}`.toLowerCase();

  // 1. Maintenance connection as admin to create throwaway DB and ensure role exists
  const admin = await new DataSource({
    ...makePgOptions('postgres', ADMIN_USER, ADMIN_PASSWORD, PG_HOST, PG_PORT),
    entities: [],
    migrations: [],
  }).initialize();

  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);

  // Ensure app role exists and is strictly NOSUPERUSER NOBYPASSRLS
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
        CREATE ROLE ${APP_USER} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${APP_PASSWORD}';
      ELSE
        ALTER ROLE ${APP_USER} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${APP_PASSWORD}';
      END IF;
    END
    $$;
  `);

  // 2. Owner connection to run migrations and grant permissions
  const owner = await new DataSource(
    makePgOptions(dbName, ADMIN_USER, ADMIN_PASSWORD, PG_HOST, PG_PORT, extraOptions),
  ).initialize();

  await owner.runMigrations();

  await owner.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_USER}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${APP_USER}`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER}`);
  await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_USER}`);
  await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_USER}`);

  // 3. App connection as roxira_app (NOSUPERUSER NOBYPASSRLS)
  const app = await new DataSource({
    ...makePgOptions(dbName, APP_USER, APP_PASSWORD, PGB_HOST, PGB_PORT, extraOptions),
    extra: { max: 10 },
  }).initialize();

  // Invariant check: verify that app role is strictly NOSUPERUSER NOBYPASSRLS
  const [roleCheck] = await app.query(
    `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
  );
  if (roleCheck?.rolsuper || roleCheck?.rolbypassrls) {
    throw new Error(
      `App role "${APP_USER}" must be NOSUPERUSER NOBYPASSRLS for tenant isolation tests, got: ${JSON.stringify(roleCheck)}`,
    );
  }

  const scope = new TenantScope(app);

  const rawQuery = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    owner.query(sql, params) as Promise<T[]>;

  const cleanup = async () => {
    try {
      await app?.destroy();
    } catch {
      // ignore
    }
    try {
      await owner?.destroy();
    } catch {
      // ignore
    }
    try {
      await admin?.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin?.destroy();
    } catch {
      // ignore
    }
  };

  return {
    dbName,
    admin,
    owner,
    app,
    scope,
    rawQuery,
    cleanup,
  };
}
