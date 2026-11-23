"""Unit tests for scripts/ci/audit_frontend_routes.py (T337 / #1286)."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ci" / "audit_frontend_routes.py"


def load_module():
    spec = importlib.util.spec_from_file_location("audit_frontend_routes", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["audit_frontend_routes"] = module
    spec.loader.exec_module(module)
    return module


class TestAuditFrontendRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_is_api_only_route_classification(self):
        """API-only controllers and patterns must be identified."""
        api_ctrls = [
            ("McpController", "/mcp/tools"),
            ("ClientErrorsController", "/enterprise-hub/client-errors/"),
            ("SystemHealthController", "/health/system"),
            ("ReceiptBotWebhookController", "/api/integrations/receipt-bot/webhook"),
            ("TenantExportController", "/enterprise-hub/data-import/export/json"),
        ]
        for ctrl, url in api_ctrls:
            is_api, reason = self.mod.is_api_only_route(ctrl, url)
            self.assertTrue(is_api, f"Expected {ctrl} to be marked API-only")
            self.assertIsNotNone(reason)

        # Standard business controllers must NOT be marked API-only
        business_ctrls = [
            ("AccountingController", "/enterprise-hub/accounting/accounts"),
            ("PurchaseController", "/enterprise-hub/inventory/purchasing/orders"),
            ("SalesController", "/enterprise-hub/sales/orders"),
            ("InvoicingController", "/enterprise-hub/invoicing/"),
        ]
        for ctrl, url in business_ctrls:
            is_api, reason = self.mod.is_api_only_route(ctrl, url)
            self.assertFalse(is_api, f"Expected {ctrl} to not be API-only")
            self.assertIsNone(reason)

    def test_load_routes_from_snapshot(self):
        """Snapshot parsing must accurately extract verb, URL, controller, action, and status."""
        mock_snapshot = {
            "GET /enterprise-hub/accounting/accounts (AccountingController.getChartOfAccounts)": {
                "policy": "accounting:read"
            },
            "POST /enterprise-hub/inventory/purchasing/orders (PurchaseController.createOrder)": {
                "policy": "inventory:create"
            },
            "GET /health/system (SystemHealthController.check)": {
                "policy": "public"
            },
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            snap_path = pathlib.Path(tmp_dir) / "snapshot.json"
            snap_path.write_text(json.dumps(mock_snapshot), encoding="utf-8")

            routes = self.mod.load_routes_from_snapshot(snap_path)
            self.assertEqual(len(routes), 3)

            r0 = next(r for r in routes if r.controller == "AccountingController")
            self.assertEqual(r0.method, "GET")
            self.assertEqual(r0.url, "/enterprise-hub/accounting/accounts")
            self.assertEqual(r0.action, "getChartOfAccounts")
            self.assertEqual(r0.status, "UNCALLED")

            r_api = next(r for r in routes if r.controller == "SystemHealthController")
            self.assertEqual(r_api.status, "API_ONLY")
            self.assertIn("Infrastructure", r_api.reason or "")

    def test_route_matching_with_corpus(self):
        """FrontendCorpus must identify called vs uncalled routes."""
        mock_routes = [
            self.mod.RouteInfo(
                raw_id="GET /enterprise-hub/accounting/accounts (AccountingController.list)",
                method="GET",
                url="/enterprise-hub/accounting/accounts",
                controller="AccountingController",
                action="list",
                status="UNCALLED",
            ),
            self.mod.RouteInfo(
                raw_id="POST /enterprise-hub/inventory/purchasing/orders (PurchaseController.create)",
                method="POST",
                url="/enterprise-hub/inventory/purchasing/orders",
                controller="PurchaseController",
                action="create",
                status="UNCALLED",
            ),
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            src_dir = pathlib.Path(tmp_dir)
            (src_dir / "lib").mkdir()
            (src_dir / "lib" / "client.ts").write_text(
                'const ACCOUNTING_ENDPOINT = "/api/backend/enterprise-hub/accounting";\n'
                'return apiRequest(`${ACCOUNTING_ENDPOINT}/accounts`);\n',
                encoding="utf-8",
            )

            corpus = self.mod.FrontendCorpus(src_dir)
            self.mod.audit_routes(mock_routes, corpus)

            self.assertEqual(mock_routes[0].status, "CALLED")
            self.assertEqual(mock_routes[1].status, "UNCALLED")

    def test_orphan_page_detection(self):
        """Pages with no inbound link or menu entry must be detected as orphans."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            src_dir = pathlib.Path(tmp_dir)
            app_dir = src_dir / "app"
            lib_dir = src_dir / "lib"
            lib_dir.mkdir(parents=True)

            # Create pages
            p_dashboard = app_dir / "app" / "page.tsx"
            p_review = app_dir / "app" / "accounting" / "review" / "page.tsx"
            p_kartable = app_dir / "app" / "tax" / "kartable" / "page.tsx"
            p_public = app_dir / "login" / "page.tsx"

            for p in (p_dashboard, p_review, p_kartable, p_public):
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("export default function Page() { return <div>Page</div>; }", encoding="utf-8")

            # Nav menu links dashboard only
            (lib_dir / "nav-menu.ts").write_text(
                'export const MENU = [{ href: "/app", label: "Dashboard" }];\n',
                encoding="utf-8",
            )

            corpus = self.mod.FrontendCorpus(src_dir)
            pages = self.mod.audit_pages(src_dir, app_dir, corpus)

            page_map = {p.route: p for p in pages}
            self.assertIn("/app", page_map)
            self.assertFalse(page_map["/app"].is_orphan)
            self.assertTrue(page_map["/app"].in_nav_menu)

            # /app/accounting/review and /app/tax/kartable are orphans
            self.assertIn("/app/accounting/review", page_map)
            self.assertTrue(page_map["/app/accounting/review"].is_orphan)

            self.assertIn("/app/tax/kartable", page_map)
            self.assertTrue(page_map["/app/tax/kartable"].is_orphan)

            # /login is an exempted public entrypoint
            self.assertIn("/login", page_map)
            self.assertFalse(page_map["/login"].is_orphan)

    def test_live_repo_audit_execution(self):
        """Running the audit on the live repo must complete and identify expected metrics."""
        report = self.mod.run_audit(REPO_ROOT)
        self.assertEqual(report.total_routes, 529)
        self.assertGreater(report.called_routes, 300)
        self.assertGreater(report.uncalled_routes, 50)
        self.assertGreater(report.api_only_routes, 0)
        self.assertGreater(report.total_pages, 80)
        self.assertGreater(report.orphan_app_pages_count, 0)

        orphan_routes = {p["route"] for p in report.orphan_app_pages}
        self.assertIn("/app/accounting/review", orphan_routes)
        self.assertIn("/app/tax/kartable", orphan_routes)
        self.assertIn("/app/damages", orphan_routes)

        md = self.mod.format_markdown(report)
        self.assertIn("## 🔍 Frontend Route & Orphan-Page Audit", md)
        self.assertIn("/app/accounting/review", md)

        console = self.mod.format_console(report)
        self.assertIn("ROXIRA FRONTEND ROUTE & ORPHAN-PAGE AUDIT", console)


if __name__ == "__main__":
    unittest.main()
