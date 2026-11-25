import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { UserTotpEntity } from './entities/user-totp.entity';
import { TotpRepository } from './repositories/totp.repository';

const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';

describePg('user_totp FORCE RLS under roxira_app', () => {
  let testDb: TestDatabaseContext;
  let repo: TotpRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('user_totp_rls');
    repo = new TotpRepository(testDb.appDataSource.getRepository(UserTotpEntity));
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('isolates user_totp rows by app.user_id and fails closed without it', async () => {
    const saved = await repo.save({
      userId: USER_1,
      secretEnc: 'enc-secret-1',
      enabled: true,
      lastUsedStep: null,
    });
    expect(saved.userId).toBe(USER_1);

    const found1 = await repo.find(USER_1);
    expect(found1?.secretEnc).toBe('enc-secret-1');

    // User 2 cannot read User 1's TOTP secret
    const found2 = await repo.find(USER_2);
    expect(found2).toBeNull();

    // Fail-closed: direct query without app.user_id sees 0 rows
    const rawRows = await testDb.appDataSource.query(
      'SELECT user_id FROM public.user_totp WHERE user_id = $1',
      [USER_1],
    );
    expect(rawRows).toHaveLength(0);

    // advanceStep works for owner, fails for other user
    const advanced = await repo.advanceStep(USER_1, 42, null);
    expect(advanced).toBe(true);
    const otherAdvanced = await repo.advanceStep(USER_2, 43, '42');
    expect(otherAdvanced).toBe(false);

    await repo.remove(USER_1);
    expect(await repo.find(USER_1)).toBeNull();
  });
});
