import * as fs from 'fs';
import * as path from 'path';
import { AiDataPolicyError, loadAiDataPolicy, parseAiDataPolicy } from './ai-data-policy';

const MODELS = `
roles:
  free:
    data_policy: non_sensitive_only
    models: [{ id: a/b:free }]
  cheap:
    data_policy: standard
    models: [{ id: c/d }]
`;
const POLICY = (mode: string) =>
  JSON.stringify({
    schema_version: 1,
    mode,
    provider_classes: { non_sensitive_only: 'may_log', standard: 'no_log' },
    modes: {
      test_accounts: { public: ['may_log', 'no_log'], 'tenant-business': ['may_log', 'no_log'], personal: ['may_log', 'no_log'] },
      production: { public: ['may_log', 'no_log'], 'tenant-business': ['no_log'], personal: ['no_log'] },
    },
  });

describe('AiDataPolicy', () => {
  it('test_accounts mode (current owner rule) lets free may-log roles see tenant data', () => {
    const p = parseAiDataPolicy(MODELS, POLICY('test_accounts'));
    expect(p.mode).toBe('test_accounts');
    expect(p.allowsRole('tenant-business', 'free')).toBe(true);
    expect(p.allowsRole('personal', 'free')).toBe(true);
    expect(() => p.assertRole('personal', 'cheap')).not.toThrow();
  });

  it('production mode keeps may-log providers away from tenant and personal data, not from public', () => {
    const p = parseAiDataPolicy(MODELS, POLICY('production'));
    expect(p.allowsRole('public', 'free')).toBe(true);
    expect(p.allowsRole('tenant-business', 'free')).toBe(false);
    expect(p.allowsRole('personal', 'free')).toBe(false);
    expect(p.allowsRole('personal', 'cheap')).toBe(true);
    expect(() => p.assertRole('tenant-business', 'free')).toThrow(AiDataPolicyError);
    expect(p.filterByRole('tenant-business', [{ role: 'free' }, { role: 'cheap' }])).toEqual([{ role: 'cheap' }]);
  });

  it('a free-tier model id is may_log even when listed under a paid role', () => {
    const p = parseAiDataPolicy(MODELS, POLICY('production'));
    expect(p.providerClassOfModel('cheap', 'vendor/x:free')).toBe('may_log');
    expect(p.providerClassOfModel('cheap', 'openrouter/free')).toBe('may_log');
    expect(p.providerClassOfModel('cheap', 'vendor/paid')).toBe('no_log');
    expect(() => p.assertModel('tenant-business', 'cheap', 'vendor/x:free')).toThrow(AiDataPolicyError);
    expect(() => p.assertModel('tenant-business', 'cheap', 'vendor/paid')).not.toThrow();
    expect(p.filterModels('personal', [{ id: 'a:free', role: 'cheap' }, { id: 'b', role: 'cheap' }])).toEqual([{ id: 'b', role: 'cheap' }]);
    // test_accounts keeps the owner rule: nothing is filtered
    expect(parseAiDataPolicy(MODELS, POLICY('test_accounts')).allowsModel('personal', 'cheap', 'a:free')).toBe(true);
  });

  it('the env override flips the switch without touching the file', () => {
    const p = parseAiDataPolicy(MODELS, POLICY('test_accounts'), 'production');
    expect(p.mode).toBe('production');
    expect(p.allowsRole('tenant-business', 'free')).toBe(false);
  });

  it('fails closed: missing file, bad mode, broken table or unknown role', () => {
    for (const p of [
      parseAiDataPolicy(MODELS, null),
      parseAiDataPolicy(MODELS, POLICY('nonsense')),
      parseAiDataPolicy(MODELS, '{ oops'),
      parseAiDataPolicy(MODELS, JSON.stringify({ mode: 'test_accounts', modes: { test_accounts: { public: ['no_log'] } } })),
    ]) {
      expect(p.mode).toBe('production');
      expect(p.allowsRole('tenant-business', 'free')).toBe(false);
    }
    expect(parseAiDataPolicy(MODELS, POLICY('test_accounts')).allowsRole('personal', 'unknown-role')).toBe(true);
    expect(parseAiDataPolicy(MODELS, POLICY('production')).allowsRole('personal', 'unknown-role')).toBe(false);
  });

  it('a production table cannot be edited looser than the strict rules', () => {
    const loose = POLICY('production').replace('"tenant-business":["no_log"]', '"tenant-business":["may_log","no_log"]');
    expect(parseAiDataPolicy(MODELS, loose).allowsRole('tenant-business', 'free')).toBe(false);
  });
});

describe('repository config/ai_data_policy.json', () => {
  const root = path.resolve(__dirname, '../../../../config');
  const modelsPath = path.join(root, 'models.yaml');

  it('is the owner rule today (test_accounts) and holds no model ids', () => {
    const policy = loadAiDataPolicy([modelsPath], {});
    expect(policy.mode).toBe('test_accounts');
    expect(policy.providerClassOfRole('free')).toBe('may_log');
    expect(policy.providerClassOfRole('cheap')).toBe('no_log');
    const text = fs.readFileSync(path.join(root, 'ai_data_policy.json'), 'utf8');
    expect(text).not.toMatch(/"[a-z0-9-]+\/[a-z0-9.-]+(:free)?"/i);
  });

  it('flipping the switch leaves the assistant only no-log roles for tenant data', () => {
    const policy = loadAiDataPolicy([modelsPath], { ROXIRA_AI_DATA_MODE: 'production' });
    expect(policy.allowsRole('tenant-business', 'free')).toBe(false);
    expect(policy.allowsRole('tenant-business', 'cheap')).toBe(true);
    expect(policy.allowsRole('tenant-business', 'eu_tenant')).toBe(true);
  });

  it('T285: EU tenant profile flag enforces EU-resident no-training route table and blocks non-EU / may-log vendors', () => {
    const policy = loadAiDataPolicy([modelsPath], { ROXIRA_EU_TENANT_AI_PROFILE: 'true' });
    expect(policy.mode).toBe('eu_tenant');
    expect(policy.euProfile.enabled).toBe(true);
    expect(policy.euProfile.defaultForTaxAdvisorTenants).toBe(true);
    expect(policy.euProfile.allowServiceImprovementDefault).toBe(false);

    // Route table: public allows all, customer data classes allow ONLY eu_no_log
    expect(policy.allowsRole('public', 'free')).toBe(true);
    expect(policy.allowsRole('public', 'cheap')).toBe(true);
    expect(policy.allowsRole('public', 'eu_tenant')).toBe(true);
    expect(policy.allowsRole('tenant-business', 'free')).toBe(false);
    expect(policy.allowsRole('tenant-business', 'cheap')).toBe(false);
    expect(policy.allowsRole('tenant-business', 'strong')).toBe(false);
    expect(policy.allowsRole('tenant-business', 'eu_tenant')).toBe(true);
    expect(policy.allowsRole('personal', 'cheap')).toBe(false);
    expect(policy.allowsRole('personal', 'eu_tenant')).toBe(true);

    // Proves blocked path: non-EU and may-log models throw AiDataPolicyError
    expect(() => policy.assertModel('tenant-business', 'cheap', 'deepseek/deepseek-v4.1-flash')).toThrow(AiDataPolicyError);
    expect(() => policy.assertModel('personal', 'cheap', 'qwen/qwen3.8-flash')).toThrow(AiDataPolicyError);
    expect(() => policy.assertModel('tenant-business', 'eu_tenant', 'deepseek/deepseek-v4.1-flash')).toThrow(AiDataPolicyError);
    expect(() => policy.assertModel('tenant-business', 'eu_tenant', 'mistralai/mistral-small:free')).toThrow(AiDataPolicyError);
    expect(() => policy.assertModel('tenant-business', 'eu_tenant', 'mistral-medium-latest')).not.toThrow();

    // filterModels keeps only EU-resident no-training models
    const filtered = policy.filterModels('tenant-business', [
      { id: 'deepseek/deepseek-v4.1-flash', role: 'cheap' },
      { id: 'qwen/qwen3.8-flash', role: 'cheap' },
      { id: 'mistralai/mistral-small-24b-instruct-2501:free', role: 'eu_tenant' },
      { id: 'mistral-medium-latest', role: 'eu_tenant' },
    ]);
    expect(filtered).toEqual([{ id: 'mistral-medium-latest', role: 'eu_tenant' }]);
  });

  it('T285: forTenant() forces EU-resident no-training profile for EU and tax-advisor tenants even when global mode is test_accounts', () => {
    const base = loadAiDataPolicy([modelsPath], {});
    expect(base.mode).toBe('test_accounts');

    const taxAdvisorPolicy = base.forTenant({ isTaxAdvisor: true });
    expect(taxAdvisorPolicy.mode).toBe('eu_tenant');
    expect(taxAdvisorPolicy.allowsModel('tenant-business', 'cheap', 'deepseek/deepseek-v4.1-flash')).toBe(false);
    expect(taxAdvisorPolicy.allowsModel('tenant-business', 'eu_tenant', 'mistral-medium-latest')).toBe(true);

    const euPolicy = base.forTenant({ isEuTenant: true });
    expect(euPolicy.mode).toBe('eu_tenant');
    expect(() => euPolicy.assertModel('personal', 'cheap', 'google/gemini-3.1-flash-lite')).toThrow(AiDataPolicyError);
  });
});
