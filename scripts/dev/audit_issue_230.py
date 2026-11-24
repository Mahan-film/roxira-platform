#!/usr/bin/env python3
"""Verify and regenerate docs/strategy/ISSUE_230_AUDIT_2026_11.md from git state.

Every cited path is verified with `git cat-file -e <ref>:<path>`.
Two columns are computed from the live codebase:
- Reachable from Menu: checks `output_apps/enterprise_hub/frontend/src/lib/nav-menu.ts`
- Called by Frontend: checks `output_apps/enterprise_hub/frontend/src/lib/api/`

Usage:
    python3 scripts/dev/audit_issue_230.py --write
    python3 scripts/dev/audit_issue_230.py --check
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

AUDIT_PATH = Path("docs/strategy/ISSUE_230_AUDIT_2026_11.md")
NAV_MENU_PATH = "output_apps/enterprise_hub/frontend/src/lib/nav-menu.ts"
API_CLIENT_DIR = "output_apps/enterprise_hub/frontend/src/lib/api"


@dataclass(frozen=True)
class AuditItem:
    num: int
    description: str
    code: tuple[str, ...]
    specs: tuple[str, ...]
    pages: tuple[str, ...]
    help_docs: tuple[str, ...]
    req_row: str
    menu_routes: tuple[str, ...]
    api_clients: tuple[str, ...]
    status_note: str


ITEMS: tuple[AuditItem, ...] = (
    AuditItem(
        1,
        "Chart of accounts: tree, floating detail levels, cost centres, projects",
        (
            "output_apps/enterprise_hub/modules/accounting/services/dimension.service.ts",
            "output_apps/enterprise_hub/modules/accounting/controllers/dimension.controller.ts",
            "output_apps/enterprise_hub/modules/accounting/entities/dimension.entity.ts",
            "output_apps/enterprise_hub/modules/accounting/constants/iran-chart-template.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/accounting/dimensions.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/constants/iran-chart-template.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/chart/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/dimensions/page.tsx",
        ),
        (
            "docs/help/fa/21-chart-of-accounts.md",
            "docs/help/fa/26-cost-centres-and-projects.md",
        ),
        "`E-02`",
        ("/app/accounting/chart", "/app/accounting/dimensions"),
        ("accounting-client.ts", "dimensions-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        2,
        "Vouchers: manual, draft, temporary, reversal, copy, attachments, edit lock, recurring",
        (
            "output_apps/enterprise_hub/modules/accounting/services/accounting.service.ts",
            "output_apps/enterprise_hub/modules/accounting/services/recurring-voucher.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/accounting/accounting.tenant.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/recurring-vouchers.pg.spec.ts",
            "output_apps/enterprise_hub/frontend/src/lib/voucher-actions.test.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/vouchers/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/recurring-vouchers/page.tsx",
            "output_apps/enterprise_hub/frontend/src/components/accounting/journal-entries-table.tsx",
        ),
        (
            "docs/help/fa/22-vouchers.md",
            "docs/help/fa/18-recurring-vouchers.md",
            "docs/help/fa/38-voucher-actions.md",
        ),
        "`E-01`",
        ("/app/accounting/vouchers", "/app/accounting/recurring-vouchers"),
        ("accounting-client.ts", "recurring-vouchers-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        3,
        "Ledger invariants: property tests (fast-check); hash-chained audit",
        (
            "output_apps/enterprise_hub/modules/accounting/services/accounting.service.ts",
            "output_apps/enterprise_hub/modules/accounting/money.ts",
            "output_apps/enterprise_hub/modules/access/services/ledger-audit.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/accounting/accounting.ledger.property.spec.ts",
            "output_apps/enterprise_hub/modules/access/services/ledger-audit.service.spec.ts",
        ),
        ("output_apps/enterprise_hub/frontend/src/app/app/settings/audit/page.tsx",),
        ("docs/help/fa/22-vouchers.md",),
        "`E-01`",
        ("/app/settings/audit", "/app/settings"),
        ("access-client.ts", "accounting-client.ts"),
        "Implemented on main (audit page linked from `/app/settings`)",
    ),
    AuditItem(
        4,
        "Fiscal years: open, period locks, closing entries, carry-forward, read-only closed years",
        (
            "output_apps/enterprise_hub/modules/accounting/services/fiscal-year.service.ts",
            "output_apps/enterprise_hub/modules/accounting/entities/fiscal-year.entity.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/accounting/fiscal-close.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/closed-fiscal-year.pg.spec.ts",
        ),
        ("output_apps/enterprise_hub/frontend/src/app/app/accounting/fiscal-years/page.tsx",),
        ("docs/help/fa/23-fiscal-years.md",),
        "`E-01`, `E-04`",
        ("/app/accounting/fiscal-years",),
        ("accounting-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        5,
        "Reports: trial balance, ledgers, statements, ageing, budget, report builder, combined report",
        (
            "output_apps/enterprise_hub/modules/accounting/services/cost-centre-report.service.ts",
            "output_apps/enterprise_hub/modules/report_builder/services/report-builder.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/report_builder/report-builder.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/financial-reports.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/cost-centres.pg.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/reports/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/report-builder/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/reports/cost-centres/page.tsx",
        ),
        (
            "docs/help/fa/09-reports.md",
            "docs/help/fa/32-report-builder.md",
        ),
        "`E-03`",
        ("/app/reports", "/app/accounting/report-builder"),
        ("accounting-reports-client.ts", "report-builder-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        6,
        "Fixed assets: register, monthly depreciation run, disposal",
        (
            "output_apps/enterprise_hub/modules/accounting/services/fixed-asset.service.ts",
            "output_apps/enterprise_hub/modules/accounting/entities/fixed-asset.entity.ts",
            "output_apps/enterprise_hub/migrations/1789900000300-AddFixedAssetDisposal.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/accounting/fixed-assets.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/fixed-asset-disposal.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/assets/depreciation.spec.ts",
        ),
        ("output_apps/enterprise_hub/frontend/src/app/app/accounting/fixed-assets/page.tsx",),
        ("docs/help/fa/20-fixed-assets.md",),
        "`I-04`",
        ("/app/accounting/fixed-assets",),
        ("fixed-assets-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        7,
        "Posting-rules engine: one template per doc type, tenant mapping, defaults from chart",
        (
            "output_apps/enterprise_hub/modules/posting_rules/domain/posting-engine.ts",
            "output_apps/enterprise_hub/modules/posting_rules/services/posting-rules.service.ts",
            "output_apps/enterprise_hub/modules/posting_rules/domain/posting-templates.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/posting_rules/domain/posting-engine.spec.ts",
            "output_apps/enterprise_hub/modules/posting_rules/services/posting-rules.service.spec.ts",
        ),
        ("output_apps/enterprise_hub/frontend/src/app/app/settings/posting-rules/page.tsx",),
        ("docs/help/fa/15-posting-rules.md",),
        "`E-04`",
        ("/app/settings",),
        ("posting-rules-client.ts",),
        "Implemented on main (linked from `/app/settings`)",
    ),
    AuditItem(
        8,
        "Adapters: cheques, payroll, tax and treasury, invoicing, inventory, POS close, fixed assets",
        (
            "output_apps/enterprise_hub/modules/posting_rules/domain/cheque-templates.ts",
            "output_apps/enterprise_hub/modules/hr/posting/payroll-posting-proposal.ts",
            "output_apps/enterprise_hub/modules/treasury/posting/treasury-posting-rules.adapter.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/cheques/cheques.posting-rules.spec.ts",
            "output_apps/enterprise_hub/modules/hr/payroll.posting-rules.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/assets/depreciation.posting-rules.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/petty-cash.posting-rules.spec.ts",
        ),
        ("output_apps/enterprise_hub/frontend/src/app/app/settings/posting-rules/page.tsx",),
        ("docs/help/fa/15-posting-rules.md",),
        "`E-04`",
        ("/app/settings",),
        ("posting-rules-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        9,
        "Receipts and payments: linked to parties, invoice allocation, partials, advances",
        (
            "output_apps/enterprise_hub/modules/treasury/services/treasury.service.ts",
            "output_apps/enterprise_hub/modules/treasury/entities/treasury-document.entity.ts",
            "output_apps/enterprise_hub/modules/treasury/entities/treasury-allocation.entity.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/treasury/treasury.pg.spec.ts",
            "output_apps/enterprise_hub/modules/treasury/treasury.service.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/money/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/treasury/page.tsx",
        ),
        ("docs/help/fa/16-treasury.md", "docs/help/fa/42-treasury-settlement.md"),
        "`TRS-01`",
        ("/app/money",),
        ("treasury-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        10,
        "Cash boxes, bank accounts, transfers, POS settlements, bank fees",
        (
            "output_apps/enterprise_hub/modules/treasury/services/treasury.service.ts",
            "output_apps/enterprise_hub/modules/treasury/services/bank-statement.service.ts",
        ),
        ("output_apps/enterprise_hub/modules/treasury/bank-statement.pg.spec.ts",),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/cash-boxes/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/bank/page.tsx",
        ),
        ("docs/help/fa/41-cash-boxes-and-pos.md",),
        "`TRS-02`",
        ("/app/money",),
        ("treasury-client.ts", "banking-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        11,
        "Cheques (Sayad, CHK-01), bank reconciliation, petty cash",
        (
            "output_apps/enterprise_hub/modules/cheques/services/cheques.service.ts",
            "output_apps/enterprise_hub/modules/accounting/services/petty-cash.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/cheques/cheques.pg.spec.ts",
            "output_apps/enterprise_hub/modules/accounting/petty-cash.pg.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/cheques/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/bank/reconcile/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/petty-cash/page.tsx",
        ),
        (
            "docs/help/fa/06-cheques.md",
            "docs/help/fa/07-bank-reconciliation.md",
            "docs/help/fa/24-petty-cash.md",
        ),
        "`CHK-01`, `BNK-01`, `TRS-03`",
        ("/app/money",),
        ("cheques-client.ts", "bank-recon-client.ts", "accounting-client.ts"),
        "Implemented on main (money hub links to cheques, reconcile, petty cash)",
    ),
    AuditItem(
        12,
        "Sales cycle, purchase cycle with landed cost, stock FIFO, inventory counts",
        (
            "output_apps/enterprise_hub/modules/sales/services/sales.service.ts",
            "output_apps/enterprise_hub/modules/inventory/services/inventory.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/sales/sales.pg.spec.ts",
            "output_apps/enterprise_hub/modules/inventory/inventory.tenant.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/sales/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/invoicing/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/inventory/page.tsx",
        ),
        (
            "docs/help/fa/27-sales-cycle.md",
            "docs/help/fa/28-purchase-cycle.md",
            "docs/help/fa/25-inventory-counts.md",
        ),
        "`INV-01`, `PUR-01`, `SLS-01`",
        ("/app/sales", "/app/invoicing", "/app/inventory"),
        ("sales-client.ts", "invoicing-client.ts", "inventory-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        13,
        "Contracting and project accounting",
        (
            "output_apps/enterprise_hub/modules/contracting/services/contract.service.ts",
            "output_apps/enterprise_hub/modules/contracting/services/profitability.service.ts",
        ),
        ("output_apps/enterprise_hub/modules/contracting/contracting.pg.spec.ts",),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/contracting/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/contracting/profitability/page.tsx",
        ),
        ("docs/help/fa/29-contracting.md",),
        "`CON-01`",
        ("/app/contracting",),
        ("contracting-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        14,
        "VAT and seasonal returns, Moadian all patterns, corporate tax workbench",
        (
            "output_apps/enterprise_hub/modules/tax_compliance/services/moadian.service.ts",
            "output_apps/enterprise_hub/modules/tax_compliance/services/tax-compliance.service.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/tax_compliance/moadian.spec.ts",
            "output_apps/enterprise_hub/modules/tax_compliance/tax-reports.pg.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/tax/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/tax/previews/page.tsx",
        ),
        ("docs/help/fa/14-tax-previews.md", "docs/help/fa/35-tax-inspector-package.md"),
        "`TAX-01`",
        ("/app/tax", "/app/tax/previews"),
        ("tax-compliance-client.ts", "tax-previews-client.ts", "moadian-seasonal-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        15,
        "Payroll voucher, leave, attendance, loans",
        (
            "output_apps/enterprise_hub/modules/hr/services/payroll-run.service.ts",
            "output_apps/enterprise_hub/modules/hr/statutory/statutory.controller.ts",
        ),
        (
            "output_apps/enterprise_hub/modules/hr/payroll-run.tenant.spec.ts",
            "output_apps/enterprise_hub/modules/hr/tamin-dbf-bytes.spec.ts",
        ),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/hr/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/hr/payroll/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/hr/statutory/page.tsx",
        ),
        ("docs/help/fa/08-payroll.md",),
        "`HR-01`",
        ("/app/hr", "/app/hr/payroll", "/app/hr/statutory"),
        ("hr-client.ts", "attendance-events-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        16,
        "#294 App shell: sidebar, user menu, tenant switcher, RTL, Jalali date",
        (
            "output_apps/enterprise_hub/frontend/src/components/app/app-shell.tsx",
            "output_apps/enterprise_hub/frontend/src/lib/nav-menu.ts",
        ),
        ("e2e/tests/app-shell.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/page.tsx",),
        ("docs/help/fa/01-first-login-and-creating-a-business.md",),
        "General",
        ("/app",),
        ("auth-client.ts", "tenants-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        17,
        "#295 Landing page: hero, feature cards, pricing, testimonials",
        ("output_apps/enterprise_hub/frontend/src/app/page.tsx",),
        ("e2e/tests/homepage.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/page.tsx",),
        ("docs/help/fa/01-first-login-and-creating-a-business.md",),
        "General",
        (),
        (),
        "Public landing route `/` (not inside `/app` sidebar)",
    ),
    AuditItem(
        18,
        "#296 Split /app/accounting: vouchers list and chart of accounts",
        (
            "output_apps/enterprise_hub/frontend/src/components/accounting/journal-entries-table.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/chart/page.tsx",
        ),
        ("e2e/app/03-accounting.spec.ts",),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/vouchers/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/chart/page.tsx",
        ),
        ("docs/help/fa/21-chart-of-accounts.md", "docs/help/fa/22-vouchers.md"),
        "`E-01`, `E-02`",
        ("/app/accounting/vouchers", "/app/accounting/chart"),
        ("accounting-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        19,
        "#297 Petty cash and cash boxes under Treasury",
        ("output_apps/enterprise_hub/modules/accounting/services/petty-cash.service.ts",),
        ("output_apps/enterprise_hub/modules/accounting/petty-cash.pg.spec.ts",),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/petty-cash/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/treasury/petty-cash/page.tsx",
        ),
        ("docs/help/fa/24-petty-cash.md",),
        "`TRS-03`",
        ("/app/money",),
        ("accounting-client.ts", "treasury-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        20,
        "#298 Bank accounts page and reconciliation",
        ("output_apps/enterprise_hub/modules/treasury/services/bank-statement.service.ts",),
        ("output_apps/enterprise_hub/modules/treasury/bank-statement.pg.spec.ts",),
        (
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/bank/page.tsx",
            "output_apps/enterprise_hub/frontend/src/app/app/accounting/bank/reconcile/page.tsx",
        ),
        ("docs/help/fa/07-bank-reconciliation.md",),
        "`BNK-01`",
        ("/app/money",),
        ("banking-client.ts", "bank-recon-client.ts"),
        "Implemented on main",
    ),
    AuditItem(
        21,
        "#299 Reports hub at /app/reports",
        ("output_apps/enterprise_hub/frontend/src/lib/reports-hub.ts",),
        ("output_apps/enterprise_hub/modules/accounting/financial-reports.pg.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/reports/page.tsx",),
        ("docs/help/fa/09-reports.md",),
        "`E-03`",
        ("/app/reports",),
        ("accounting-reports-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        22,
        "#300 Fiscal years page with pre-close checklist",
        ("output_apps/enterprise_hub/modules/accounting/services/fiscal-year.service.ts",),
        ("output_apps/enterprise_hub/modules/accounting/fiscal-close.pg.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/accounting/fiscal-years/page.tsx",),
        ("docs/help/fa/23-fiscal-years.md",),
        "`E-01`",
        ("/app/accounting/fiscal-years",),
        ("accounting-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        23,
        "#301 Invoice list redesign (Jalali, ریال, due date, party link, row menu)",
        ("output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.ts",),
        ("output_apps/enterprise_hub/modules/sales/sales.pg.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/invoicing/page.tsx",),
        ("docs/help/fa/04-sales-invoice.md",),
        "`SLS-01`",
        ("/app/invoicing",),
        ("invoicing-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        24,
        "#302 Customer drawer: invoices, receipts, balance, cheques tabs",
        ("output_apps/enterprise_hub/modules/crm/services/crm.service.ts",),
        ("e2e/tests/m1-shop-month.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/crm/page.tsx",),
        ("docs/help/fa/04-sales-invoice.md",),
        "`SLS-01`",
        ("/app/crm",),
        ("crm-client.ts", "invoicing-client.ts"),
        "CRM / customer view on main; #302 drawer PR open",
    ),
    AuditItem(
        25,
        "#303 Cheques page: tabs, status chips, due-this-week strip",
        ("output_apps/enterprise_hub/modules/cheques/services/cheques.service.ts",),
        ("output_apps/enterprise_hub/modules/cheques/cheques.pg.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/cheques/page.tsx",),
        ("docs/help/fa/06-cheques.md", "docs/help/fa/36-cheque-maturity.md"),
        "`CHK-01`",
        ("/app/money",),
        ("cheques-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        26,
        "#304 Tax page: tabs and next-deadline card",
        ("output_apps/enterprise_hub/modules/tax_compliance/services/tax-compliance.service.ts",),
        ("output_apps/enterprise_hub/modules/tax_compliance/tax-compliance.tenant.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/tax/page.tsx",),
        ("docs/help/fa/14-tax-previews.md",),
        "`TAX-01`",
        ("/app/tax",),
        ("tax-compliance-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        27,
        "#305 Payroll wizard and حقوق و دستمزد grouping",
        ("output_apps/enterprise_hub/modules/hr/services/payroll-run.service.ts",),
        ("output_apps/enterprise_hub/modules/hr/payroll-run.tenant.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/hr/payroll/page.tsx",),
        ("docs/help/fa/08-payroll.md",),
        "`HR-01`",
        ("/app/hr/payroll",),
        ("hr-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        28,
        "#306 Inventory list: columns, low-stock filter, rename import to «ورود از اکسل»",
        ("output_apps/enterprise_hub/modules/inventory/services/inventory.service.ts",),
        ("output_apps/enterprise_hub/modules/inventory/inventory.tenant.spec.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/inventory/page.tsx",),
        ("docs/help/fa/25-inventory-counts.md",),
        "`INV-01`",
        ("/app/inventory",),
        ("inventory-client.ts",),
        "Implemented on main",
    ),
    AuditItem(
        29,
        "#307 Shared number formatter, unit switch (ریال/تومان), a11y colour tokens, demo seed",
        (
            "output_apps/enterprise_hub/frontend/src/lib/money-unit.ts",
            "output_apps/enterprise_hub/frontend/src/lib/format.ts",
            "output_apps/enterprise_hub/frontend/src/app/globals.css",
        ),
        ("output_apps/enterprise_hub/frontend/src/lib/fa-format.test.ts",),
        ("output_apps/enterprise_hub/frontend/src/app/app/page.tsx",),
        ("docs/help/fa/01-first-login-and-creating-a-business.md",),
        "UI/Tokens",
        ("/app",),
        (),
        "Implemented on main (shared UI utility)",
    ),
)


def git_exists(ref: str, path: str) -> bool:
    res = subprocess.run(
        ["git", "cat-file", "-e", f"{ref}:{path}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return res.returncode == 0


def git_show(ref: str, path: str) -> str:
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], text=True)


def extract_menu_hrefs(ref: str) -> set[str]:
    nav = git_show(ref, NAV_MENU_PATH)
    return set(re.findall(r'href:\s*"([^"]+)"', nav))


def check_frontend_calls(ref: str, clients: tuple[str, ...]) -> str:
    if not clients:
        return "N/A (UI/public)"
    present: list[str] = []
    missing: list[str] = []
    for client in clients:
        path = f"{API_CLIENT_DIR}/{client}"
        if git_exists(ref, path):
            present.append(f"`{client}`")
        else:
            missing.append(client)
    if missing:
        raise RuntimeError(f"Missing API client(s) on {ref}: {missing}")
    return f"Yes ({', '.join(present)})"


def check_menu_reachability(menu_hrefs: set[str], routes: tuple[str, ...]) -> str:
    if not routes:
        return "No (public route)"
    matched = [f"`{r}`" for r in routes if r in menu_hrefs]
    if matched:
        return f"Yes ({', '.join(matched)})"
    return "No"


def validate_all_paths(ref: str) -> list[str]:
    errors: list[str] = []
    for item in ITEMS:
        for path in (*item.code, *item.specs, *item.pages, *item.help_docs):
            if not git_exists(ref, path):
                errors.append(f"Item #{item.num}: missing on {ref}: {path}")
    return errors


def render_markdown(ref: str) -> str:
    errors = validate_all_paths(ref)
    if errors:
        raise RuntimeError("Path verification failed:\n" + "\n".join(errors))

    menu_hrefs = extract_menu_hrefs(ref)
    head_sha = subprocess.check_output(["git", "rev-parse", "--short", ref], text=True).strip()

    lines = [
        "# Comprehensive Audit of Issue #230 (All 29 Items)",
        "",
        f"> **Verified against**: `{ref}` (`{head_sha}`) via `scripts/dev/audit_issue_230.py` (`git cat-file -e`)  ",
        "> **Standard**: Every cited path is verified on `origin/main`, plus menu reachability (`nav-menu.ts`) and frontend API client wiring (`lib/api/`).  ",
        "> **Rule**: Strictly read-only; no checkboxes in Issue #230 are ticked.",
        "",
        "---",
        "",
        "## Summary Matrix of the 29 Items",
        "",
        "| # | Item Description in #230 | Code (Backend / Core) | Specs | Page (Frontend) | Persian Help | Requirements Row | Reachable from Menu | Called by Frontend | Status Summary |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    for item in ITEMS:
        code_col = "<br>".join(f"`{p}`" for p in item.code)
        specs_col = "<br>".join(f"`{p}`" for p in item.specs)
        pages_col = "<br>".join(f"`{p}`" for p in item.pages)
        help_col = "<br>".join(f"`{p}`" for p in item.help_docs)
        menu_col = check_menu_reachability(menu_hrefs, item.menu_routes)
        fe_col = check_frontend_calls(ref, item.api_clients)
        lines.append(
            f"| {item.num} | {item.description} | {code_col} | {specs_col} | {pages_col} | {help_col} | {item.req_row} | {menu_col} | {fe_col} | {item.status_note} |"
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## Verification Summary",
            f"- All 29 rows verified against `{ref}` (`{head_sha}`) with zero missing paths.",
            "- Re-generate with `python3 scripts/dev/audit_issue_230.py --write` and verify with `python3 scripts/dev/audit_issue_230.py --check`.",
        ]
    )
    return "\n".join(lines) + "\n"


def check_existing_doc(ref: str) -> int:
    text = AUDIT_PATH.read_text(encoding="utf-8")
    errors: list[str] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.startswith("| ") or line.startswith("| # ") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        # Check Code, Specs, Page, Persian Help columns (indices 2, 3, 4, 5)
        for col_idx in (2, 3, 4, 5):
            if col_idx >= len(cells):
                continue
            for token in re.findall(r"`([^`]+)`", cells[col_idx]):
                if not git_exists(ref, token):
                    errors.append(f"{AUDIT_PATH}:{line_no}: missing `{token}` on {ref}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"OK: all cited paths in {AUDIT_PATH} exist on {ref}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit and regenerate ISSUE_230_AUDIT_2026_11.md")
    parser.add_argument("--ref", default="origin/main", help="Git ref to verify against (default: origin/main)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="Regenerate docs/strategy/ISSUE_230_AUDIT_2026_11.md")
    group.add_argument("--check", action="store_true", help="Verify all cited paths in ISSUE_230_AUDIT_2026_11.md")
    args = parser.parse_args()

    if args.write:
        content = render_markdown(args.ref)
        AUDIT_PATH.write_text(content, encoding="utf-8")
        print(f"Wrote {AUDIT_PATH} ({len(ITEMS)} items verified against {args.ref})")
        return 0
    return check_existing_doc(args.ref)


if __name__ == "__main__":
    raise SystemExit(main())
