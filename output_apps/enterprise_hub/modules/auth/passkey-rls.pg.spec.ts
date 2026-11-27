import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { PasskeyCredentialEntity } from './entities/passkey-credential.entity';
import { PasskeyRepository } from './repositories/passkey.repository';

const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';

describePg('auth_passkey_credentials FORCE RLS under roxira_app', () => {
  let testDb: TestDatabaseContext;
  let repo: PasskeyRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('passkey_rls');
    repo = new PasskeyRepository(
      testDb.appDataSource.getRepository(PasskeyCredentialEntity),
    );
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('isolates passkey rows by app.user_id and allows pre-auth SECURITY DEFINER lookup', async () => {
    const created = await repo.create({
      userId: USER_1,
      credentialId: 'cred-user-1',
      publicKey: 'pk-cose-1',
      publicKeyAlg: -7,
      signCount: 0,
      backedUp: false,
    });
    expect(created.userId).toBe(USER_1);

    // User 1 can list their passkey; User 2 sees none
    const list1 = await repo.findByUserId(USER_1);
    expect(list1).toHaveLength(1);
    const list2 = await repo.findByUserId(USER_2);
    expect(list2).toHaveLength(0);

    // Pre-auth lookup by credentialId works without app.user_id via SECURITY DEFINER
    const byCred = await repo.findByCredentialId('cred-user-1');
    expect(byCred?.userId).toBe(USER_1);

    // Direct table query without app.user_id fails closed (0 rows)
    const rawRows = await testDb.appDataSource.query(
      'SELECT id FROM public.auth_passkey_credentials WHERE credential_id = $1',
      ['cred-user-1'],
    );
    expect(rawRows).toHaveLength(0);
  });
});
