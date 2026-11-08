import {
  ALL_PERMISSIONS,
  ALL_ROLE_SCOPE_TYPES,
  ALL_SENSITIVE_FIELDS,
  AccessModule,
  CORE_MODULES,
  SELLABLE_MODULES,
  SYSTEM_ROLES,
  SystemRole,
  canGrant,
  canGrantFieldVisibility,
  isPermission,
  isRoleScopeType,
  isSensitiveField,
  resolveCustomRoleFieldVisibility,
  systemRoleFieldVisibility,
  systemRolePermissions,
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

  it('salary visibility is granted only to owner and hr by default (#584-3)', () => {
    const salaryHolders = SYSTEM_ROLES.filter((r) => r.fieldVisibility.salary).map((r) => r.key);
    expect(salaryHolders).toEqual([SystemRole.OWNER, SystemRole.HR]);
    expect(systemRoleFieldVisibility(SystemRole.ADMIN).salary).toBe(false);
    expect(systemRoleFieldVisibility(SystemRole.READ_ONLY).salary).toBe(false);
  });

  it('canGrantFieldVisibility blocks granting sensitive fields the granter lacks', () => {
    const adminVis = systemRoleFieldVisibility(SystemRole.ADMIN);
    expect(canGrantFieldVisibility(adminVis, { cost: true, margin: true })).toBe(true);
    expect(canGrantFieldVisibility(adminVis, { salary: true })).toBe(false);

    const hrVis = systemRoleFieldVisibility(SystemRole.HR);
    expect(canGrantFieldVisibility(hrVis, { salary: true })).toBe(true);
    expect(canGrantFieldVisibility(hrVis, { cost: true })).toBe(false);
  });

  it('validates role scope types and custom role field visibility defaults', () => {
    for (const st of ALL_ROLE_SCOPE_TYPES) expect(isRoleScopeType(st)).toBe(true);
    expect(isRoleScopeType('global')).toBe(false);
    for (const sf of ALL_SENSITIVE_FIELDS) expect(isSensitiveField(sf)).toBe(true);
    expect(isSensitiveField('unknown')).toBe(false);
    expect(resolveCustomRoleFieldVisibility(undefined)).toEqual({
      cost: false,
      margin: false,
      salary: false,
    });
    expect(resolveCustomRoleFieldVisibility({ cost: true })).toEqual({
      cost: true,
      margin: false,
      salary: false,
    });
  });

  it('the catalogue has no price or money concept', () => {
    expect(JSON.stringify([...ALL_PERMISSIONS, ...Object.values(AccessModule)])).not.toMatch(/price|plan|billing|cost/i);
  });
});
