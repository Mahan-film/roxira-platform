// Create a throwaway tenant + OWNER user in the CI Postgres and write a browser session file
// (localStorage "roxira.auth.session" format) for the M1 gate. Throwaway CI database only.
// Run from output_apps/enterprise_hub so `pg` and `jsonwebtoken` resolve:
//   JWT_SECRET=... node ../../scripts/ci/mint_e2e_session.js <out.json>
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: mint_e2e_session.js <out.json>');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const c = new Client({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    database: process.env.DATABASE_NAME || 'rxfresh',
  });
  await c.connect();
  const tenant = crypto.randomUUID();
  const suffix = crypto.randomBytes(3).toString('hex');
  const phone = '09' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await c.query('insert into tenants (id, name, slug) values ($1, $2, $3)', [tenant, 'e2e-m1', `e2e-m1-${suffix}`]);
  const r = await c.query(
    `insert into users (phone, "displayName", role, "serviceDomain", tenant_id, tenant_role)
     values ($1, 'E2E m1', 'ADMIN', 'ROXIRA', $2, 'OWNER') returning id`,
    [phone, tenant],
  );
  const userId = r.rows[0].id;
  await c.end();
  const accessToken = jwt.sign(
    { sub: userId, phone, role: 'ADMIN', domain: 'ROXIRA', tenantId: tenant, tenantRole: 'OWNER' },
    secret,
    { expiresIn: '3h' },
  );
  fs.writeFileSync(
    out,
    JSON.stringify({
      accessToken,
      tokenType: 'Bearer',
      user: { id: userId, phone, displayName: 'E2E m1', email: null, role: 'ADMIN', serviceDomain: 'ROXIRA', createdAt: new Date().toISOString() },
      expiresAt: Date.now() + 3 * 3600e3,
    }),
    { mode: 0o600 },
  );
  console.log(`session written to ${out} (tenant ${tenant})`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
