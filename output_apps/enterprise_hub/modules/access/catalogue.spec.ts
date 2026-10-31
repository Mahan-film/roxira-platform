import {
  ALL_PERMISSIONS, canGrant, isPermission, SELLABLE_MODULES, CORE_MODULES, SYSTEM_ROLES, SystemRole,
  AccessModule, systemRolePermissions,
} from './catalogue';

describe('permission catalogue', () => {
  it('every system role only uses permissions that exist', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it('owner holds everything; nobody else holds security:admin', () => {
    expect(systemRolePermissions(SystemRole.OWNER)).toHaveLength(ALL_PERMISSIONS.length);
    const holders = SYSTEM_ROLES.filter((r) => r.permissions.includes('security:admin')).map((r) => r.key);
    expect(holders).toEqual([SystemRole.OWNER]);
  });

  it('read_only has read of business modules only, never admin areas', () => {
    const ro = systemRolePermissions(SystemRole.READ_ONLY);
    expect(ro.every((p) => p.endsWith(':read'))).toBe(true);
    for (const m of CORE_MODULES) expect(ro).not.toContain(`${m}:read`);
    expect(ro).toHaveLength(SELLABLE_MODULES.length);
  });

  it('the legacy member role is exactly what a member could do before (CRM + assistant read)', () => {
    expect([...systemRolePermissions(SystemRole.LEGACY_MEMBER)].sort()).toEqual(
      ['assistant:read', 'crm:create', 'crm:read'],
    );
  });

  it('canGrant blocks escalation', () => {
    const sales = new Set(systemRolePermissions(SystemRole.SALES));
    expect(canGrant(sales, ['crm:read'])).toBe(true);
    expect(canGrant(sales, ['crm:read', 'accounting:read'])).toBe(false);
  });

  it('the catalogue has no price or money concept', () => {
    expect(JSON.stringify([...ALL_PERMISSIONS, ...Object.values(AccessModule)])).not.toMatch(/price|plan|billing|cost/i);
  });
});
