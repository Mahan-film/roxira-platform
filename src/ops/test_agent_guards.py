"""Good/bad fixtures for scripts/ci/check_agent_guards.py (T207). Pure: no git, no network."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/check_agent_guards.py"
M = "output_apps/enterprise_hub/modules/demo/services/demo.service.ts"
TABLES = {"fin_vouchers", "tenant_roles"}
ENTITIES = {"VoucherEntity"}


@pytest.fixture(scope="module")
def g():
    spec = importlib.util.spec_from_file_location("check_agent_guards", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def rules(findings):
    return sorted({f.rule for f in findings})


@pytest.mark.parametrize(
    "code",
    [
        "const a = Number(row.totalAmount);",
        "const a = parseFloat(entity.price);",
        "const a = parseInt(line.debit, 10);",
        "const share = invoice.total / count;",
        "const unit = result.totalCost / line.quantity;",
        "const x = Number(a.openingBalance) || 0;",
    ],
)
def test_money_bad(g, code):
    assert rules(g.scan_money(M, code + "\n")) == ["money"]


@pytest.mark.parametrize(
    "code",
    [
        "const n = Number(row.totalCount);",
        "const n = Number(query.limit);",
        "const p = parseInt(req.page, 10);",
        "const pct = used / totalBytes;",
        "const bps = (tax * 10_000n) / subtotalMinor;",
        "const r = Number((totalMinor * 10000n) / budgetMinor) / 100;",
        "const id = Number(params.taxId);",
        "const s = 'total / amount'; // Number(price)",
        "const re = /price_per_1m/.test(x);",
        "const w = Number(row.amount); // money-ok: display-only chart axis",
        "// money-ok: legacy float column read for a chart\nconst w = Number(row.total);",
    ],
)
def test_money_good(g, code):
    assert g.scan_money(M, code + "\n") == []


def test_money_scope(g):
    bad = "const a = Number(row.amount);\n"
    assert g.scan_money("output_apps/enterprise_hub/frontend/x.ts", bad) == []
    assert g.scan_money(M.replace(".service.ts", ".service.spec.ts"), bad) == []


def test_tenant_raw_datasource_bad(g):
    code = "return this.dataSource.query(`SELECT * FROM fin_vouchers WHERE tenant_id = $1`, [t]);\n"
    assert rules(g.scan_tenant(M, code, TABLES, ENTITIES)) == ["tenant"]
    code = "return this.dataSource.getRepository(VoucherEntity).find({ where: { tenantId } });\n"
    assert rules(g.scan_tenant(M, code, TABLES, ENTITIES)) == ["tenant"]


def test_tenant_processor_without_scope_bad(g):
    code = (
        "@Processor('x')\nexport class P {\n"
        " constructor(@InjectRepository(VoucherEntity) r: Repository<VoucherEntity>) {}\n}\n"
    )
    assert rules(g.scan_tenant(M, code, TABLES, ENTITIES)) == ["tenant"]


@pytest.mark.parametrize(
    "code",
    [
        "return this.tenantScope.run(t, (m) => m.query(`SELECT * FROM fin_vouchers`));",
        "return this.dataSource.query(`SELECT 1 FROM unrelated_table`);",
        "return this.dataSource.query(`SELECT pg_total_relation_size('x')`);",
        "// tenant-scope-ok: pre-login lookup\nreturn this.dataSource.query(`SELECT * FROM tenant_roles`);",
        "@Processor('x')\nexport class P {\n constructor(private readonly tenantScope: TenantScope,"
        " @InjectRepository(VoucherEntity) r: Repository<VoucherEntity>) {}\n}",
    ],
)
def test_tenant_good(g, code):
    assert g.scan_tenant(M, code + "\n", TABLES, ENTITIES) == []


@pytest.mark.parametrize(
    "code",
    [
        'const m = "gpt-4o-mini";',
        "model = 'claude-sonnet-4-5'",
        "const m = `gemini-2.5-flash`;",
        'x = "whisper-large-v3"',
        'x = "deepseek-chat"',
        'x = "qwen3-coder"',
        'x = "llama-3.3-70b"',
    ],
)
def test_model_bad(g, code):
    assert rules(g.scan_model("src/foo/bar.py", code + "\n")) == ["model"]


@pytest.mark.parametrize(
    "code",
    [
        'key = os.getenv("DEEPSEEK_API_KEY")',
        'if "deepseek/" in model:',
        'role = "claude"',
        'x = "gpt-4o"  # model-ok: asserting a legacy id is rejected',
        'name = "gemini"',
    ],
)
def test_model_good(g, code):
    assert g.scan_model("src/foo/bar.py", code + "\n") == []


def test_model_scope(g):
    bad = 'm = "gpt-4o"\n'
    assert g.scan_model("config/x.ts", bad) == []
    assert g.scan_model("src/foo/test_x.py", bad) == []
    assert g.scan_model("output_apps/enterprise_hub/modules/a/a.spec.ts", bad) == []
    assert g.scan_model("src/x.md", bad) == []


E = "output_apps/enterprise_hub/modules/demo/entities/demo.entity.ts"


@pytest.mark.parametrize(
    "col",
    [
        "@Column({ type: 'text', name: 'api_key' })\n  apiKey: string;",
        "@Column({ type: 'text' })\n  webhookSecret: string;",
        "@Column('text')\n  accessToken: string;",
        "@Column({ name: 'password' })\n  password: string;",
    ],
)
def test_secret_bad(g, col):
    assert rules(g.scan_secret(E, f"export class D {{\n  {col}\n}}\n")) == ["secret"]


@pytest.mark.parametrize(
    "col",
    [
        "@Column({ type: 'text', name: 'api_key_encrypted' })\n  apiKeyEncrypted: string;",
        "@Column({ name: 'password_hash' })\n  passwordHash: string;",
        "@Column({ name: 'secret_enc' })\n  secretEnc: string;",
        "@Column({ name: 'token_expires_at' })\n  tokenExpiresAt: Date;",
        "@Column()\n  tokenType: string;",
        "@Column()\n  name: string;",
        "// secret-ok: public webhook id, not a credential\n  @Column()\n  webhookToken: string;",
    ],
)
def test_secret_good(g, col):
    assert g.scan_secret(E, f"export class D {{\n  {col}\n}}\n") == []


def test_secret_only_entities(g):
    assert g.scan_secret("output_apps/enterprise_hub/modules/a/a.service.ts", "@Column()\n apiKey: string;\n") == []
