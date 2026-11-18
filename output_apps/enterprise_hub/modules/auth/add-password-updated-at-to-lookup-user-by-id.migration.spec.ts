import { AddPasswordUpdatedAtToLookupUserById1789900012200 } from '../../migrations/1789900012200-AddPasswordUpdatedAtToLookupUserById';

const runner = () => {
  const queries: string[] = [];
  return { queries, q: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddPasswordUpdatedAtToLookupUserById migration (T105)', () => {
  it('up() updates lookup_user_by_id to include password_updated_at and grants execute to roxira_app', async () => {
    const { q, queries } = runner();
    await new AddPasswordUpdatedAtToLookupUserById1789900012200().up(q as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid)');
    expect(sql).toContain('password_updated_at timestamp');
    expect(sql).toContain('u.password_updated_at');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.lookup_user_by_id(uuid) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.lookup_user_by_id(uuid) TO roxira_app');
    expect(sql).not.toContain('TO PUBLIC');
  });

  it('down() reverts lookup_user_by_id', async () => {
    const { q, queries } = runner();
    await new AddPasswordUpdatedAtToLookupUserById1789900012200().down(q as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.lookup_user_by_id(p_user_id uuid)');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.lookup_user_by_id(uuid) FROM PUBLIC');
    expect(sql).not.toContain('TO PUBLIC');
  });
});
