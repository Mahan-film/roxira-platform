#!/usr/bin/env python3
"""Audit backend routes and frontend pages for uncalled APIs and orphan pages (T337 / #1286).

This script performs two static audits across the Roxira platform:
1. Controller Routes: Verifies every NestJS controller endpoint registered in
   permission-matrix.snapshot.json against calls in the frontend (and API route handlers).
   Flows intentionally designed to be API-only (e.g. MCP protocol, telemetry,
   health probes, webhook receivers) are classified as such.
2. Frontend Pages: Audits every Next.js App Router page (page.tsx) under frontend/src/app
   to detect orphan pages that have no inbound links or navigation menu items.

Usage:
    python3 scripts/ci/audit_frontend_routes.py [--report-only] [--markdown] [--json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Well-known controllers and endpoints intentionally designed as API-only (machine-to-machine,
# telemetry, background integration, or external agent protocol).
API_ONLY_CONTROLLERS: Dict[str, str] = {
    "McpController": "Model Context Protocol server for AI agent tools (/mcp)",
    "ClientErrorsController": "Frontend error telemetry collection (/enterprise-hub/client-errors)",
    "SystemHealthController": "Infrastructure and orchestrator health probes (/health, /health/ready)",
    "ReceiptBotWebhookController": "Inbound third-party webhook receiver (/api/integrations/receipt-bot/webhook)",
    "TenantExportController": "Administrative CLI bulk tenant export / backup pipeline",
}

API_ONLY_URL_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"^/health"), "Health probe endpoint"),
    (re.compile(r"^/mcp/"), "MCP protocol transport"),
    (re.compile(r"^/api/integrations/"), "External webhook callback"),
]

# External or public entrypoints that are visited directly or via email tokens (not in-app orphans)
PUBLIC_ENTRYPOINT_PATTERNS: List[re.Pattern] = [
    re.compile(r"^/$"),
    re.compile(r"^/login$"),
    re.compile(r"^/signup$"),
    re.compile(r"^/offline$"),
    re.compile(r"^/privacy$"),
    re.compile(r"^/terms$"),
    re.compile(r"^/reset-password$"),
    re.compile(r"^/verify-email$"),
    re.compile(r"^/account/invite/"),
    re.compile(r"^/account/reset-password"),
    re.compile(r"^/judge/payment/callback"),
    re.compile(r"^/owner$"),
]


@dataclass
class RouteInfo:
    raw_id: str
    method: str
    url: str
    controller: str
    action: str
    status: str  # "CALLED", "UNCALLED", "API_ONLY"
    reason: Optional[str] = None


@dataclass
class PageInfo:
    route: str
    file_path: str
    category: str  # "app" or "public"
    is_orphan: bool
    in_nav_menu: bool
    references_count: int


@dataclass
class AuditReport:
    total_routes: int
    called_routes: int
    uncalled_routes: int
    api_only_routes: int
    uncalled_controllers_count: int
    total_pages: int
    linked_pages_count: int
    orphan_app_pages_count: int
    orphan_public_pages_count: int
    uncalled_by_controller: Dict[str, List[Dict[str, str]]]
    api_only_by_controller: Dict[str, List[Dict[str, str]]]
    orphan_app_pages: List[Dict[str, Any]]
    orphan_public_pages: List[Dict[str, Any]]


def find_repo_root(custom_root: Optional[Path] = None) -> Path:
    if custom_root:
        return custom_root.resolve()
    return Path(__file__).resolve().parents[2]


def is_api_only_route(controller: str, url: str) -> Tuple[bool, Optional[str]]:
    if controller in API_ONLY_CONTROLLERS:
        return True, API_ONLY_CONTROLLERS[controller]
    for pattern, reason in API_ONLY_URL_PATTERNS:
        if pattern.search(url):
            return True, reason
    return False, None


def load_routes_from_snapshot(snapshot_path: Path) -> List[RouteInfo]:
    if not snapshot_path.is_file():
        raise FileNotFoundError(f"Permission matrix snapshot not found at: {snapshot_path}")

    with open(snapshot_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    routes: List[RouteInfo] = []
    # Key shape: "METHOD /route/path (ControllerName.methodName)"
    pattern = re.compile(r"^([A-Z]+)\s+([^\s]+)\s+\(([^.]+)\.([^)]+)\)$")

    for key in sorted(data.keys()):
        m = pattern.match(key)
        if not m:
            continue
        verb, url, controller, action = m.groups()
        api_only, reason = is_api_only_route(controller, url)
        status = "API_ONLY" if api_only else "UNCALLED"
        routes.append(
            RouteInfo(
                raw_id=key,
                method=verb,
                url=url,
                controller=controller,
                action=action,
                status=status,
                reason=reason,
            )
        )
    return routes


class FrontendCorpus:
    def __init__(self, src_dir: Path):
        self.src_dir = src_dir
        self.path_to_files: Dict[str, Set[Path]] = {}
        self.files_by_domain: Dict[str, List[str]] = {}
        self.combined_text: str = ""
        self.combined_text_lower: str = ""
        self._load()

    def _load(self) -> None:
        texts: List[str] = []
        str_pattern = re.compile(r'["\'`](/[a-zA-Z0-9_\-\/\[\]]+)["\'`]')

        for p in self.src_dir.rglob("*"):
            if p.suffix in (".ts", ".tsx", ".js", ".jsx") and not p.name.endswith(".d.ts"):
                try:
                    content = p.read_text(encoding="utf-8")
                    texts.append(content)
                    for m in str_pattern.finditer(content):
                        path_str = m.group(1).rstrip("/")
                        self.path_to_files.setdefault(path_str, set()).add(p)
                except Exception:
                    pass

        self.combined_text = "\n".join(texts)
        self.combined_text_lower = self.combined_text.lower()

    def route_is_called(self, route: RouteInfo) -> bool:
        clean_url = route.url.lstrip("/")
        if clean_url in self.combined_text or route.url in self.combined_text:
            return True

        segments = [s for s in clean_url.split("/") if not s.startswith(":")]
        if not segments:
            return False

        if len(segments) >= 2:
            two_seg = f"{segments[-2]}/{segments[-1]}"
            if two_seg in self.combined_text:
                return True
        elif len(segments) == 1:
            if f"/{segments[0]}" in self.combined_text:
                return True

        domain = route.controller.replace("Controller", "").lower()
        if route.action in self.combined_text and domain in self.combined_text_lower:
            return True

        # Check if last segment is called alongside controller domain in client files
        last_seg = f"/{segments[-1]}"
        if last_seg in self.combined_text and domain in self.combined_text_lower:
            return True

        return False


def audit_routes(routes: List[RouteInfo], corpus: FrontendCorpus) -> None:
    for r in routes:
        if r.status == "API_ONLY":
            continue
        if corpus.route_is_called(r):
            r.status = "CALLED"
        else:
            r.status = "UNCALLED"


def audit_pages(src_dir: Path, app_dir: Path, corpus: FrontendCorpus) -> List[PageInfo]:
    if not app_dir.is_dir():
        return []

    # 1. Find all page.tsx files
    pages: List[Tuple[str, Path]] = []
    for p in app_dir.rglob("page.tsx"):
        rel = p.relative_to(app_dir)
        parts = [part for part in rel.parent.parts if not (part.startswith("(") and part.endswith(")"))]
        route = "/" + "/".join(parts)
        pages.append((route, p))

    # 2. Extract links from nav-menu.ts
    nav_file = src_dir / "lib" / "nav-menu.ts"
    nav_content = nav_file.read_text(encoding="utf-8") if nav_file.is_file() else ""
    nav_links = set(re.findall(r'href:\s*["\'](/[^"\']*)["\']', nav_content))

    results: List[PageInfo] = []
    for route, page_path in sorted(pages, key=lambda x: x[0]):
        is_app = route.startswith("/app")
        category = "app" if is_app else "public"
        in_nav = route in nav_links

        base_route = re.sub(r"/\[[^\]]+\]", "", route)
        if not base_route:
            base_route = "/"

        # External referencing files (excluding page file itself)
        external_files = (
            corpus.path_to_files.get(route, set()) | corpus.path_to_files.get(base_route, set())
        ) - {page_path}

        ref_count = len(external_files)
        if in_nav and page_path != nav_file:
            ref_count += 1

        is_public_entry = any(p.search(route) for p in PUBLIC_ENTRYPOINT_PATTERNS)
        is_orphan = (ref_count == 0) and not in_nav and not is_public_entry

        results.append(
            PageInfo(
                route=route,
                file_path=str(page_path.relative_to(src_dir)),
                category=category,
                is_orphan=is_orphan,
                in_nav_menu=in_nav,
                references_count=ref_count,
            )
        )
    return results


def run_audit(root_dir: Path) -> AuditReport:
    snapshot_path = (
        root_dir
        / "output_apps"
        / "enterprise_hub"
        / "modules"
        / "access"
        / "permission-matrix.snapshot.json"
    )
    src_dir = root_dir / "output_apps" / "enterprise_hub" / "frontend" / "src"
    app_dir = src_dir / "app"

    routes = load_routes_from_snapshot(snapshot_path)
    corpus = FrontendCorpus(src_dir)
    audit_routes(routes, corpus)
    pages = audit_pages(src_dir, app_dir, corpus)

    called_routes = [r for r in routes if r.status == "CALLED"]
    uncalled_routes = [r for r in routes if r.status == "UNCALLED"]
    api_only_routes = [r for r in routes if r.status == "API_ONLY"]

    uncalled_by_ctrl: Dict[str, List[Dict[str, str]]] = {}
    for r in uncalled_routes:
        uncalled_by_ctrl.setdefault(r.controller, []).append(
            {"method": r.method, "url": r.url, "action": r.action}
        )

    api_only_by_ctrl: Dict[str, List[Dict[str, str]]] = {}
    for r in api_only_routes:
        api_only_by_ctrl.setdefault(r.controller, []).append(
            {"method": r.method, "url": r.url, "action": r.action, "reason": r.reason or ""}
        )

    all_ctrls = {r.controller for r in routes if r.status != "API_ONLY"}
    called_ctrls = {r.controller for r in called_routes}
    uncalled_controllers_count = len(all_ctrls - called_ctrls)

    orphan_app_pages = [asdict(p) for p in pages if p.category == "app" and p.is_orphan]
    orphan_public_pages = [
        asdict(p)
        for p in pages
        if p.category == "public" and p.is_orphan
    ]
    linked_pages_count = len([p for p in pages if not p.is_orphan])

    return AuditReport(
        total_routes=len(routes),
        called_routes=len(called_routes),
        uncalled_routes=len(uncalled_routes),
        api_only_routes=len(api_only_routes),
        uncalled_controllers_count=uncalled_controllers_count,
        total_pages=len(pages),
        linked_pages_count=linked_pages_count,
        orphan_app_pages_count=len(orphan_app_pages),
        orphan_public_pages_count=len(orphan_public_pages),
        uncalled_by_controller=uncalled_by_ctrl,
        api_only_by_controller=api_only_by_ctrl,
        orphan_app_pages=orphan_app_pages,
        orphan_public_pages=orphan_public_pages,
    )


def format_console(report: AuditReport) -> str:
    lines = [
        "================================================================================",
        " ROXIRA FRONTEND ROUTE & ORPHAN-PAGE AUDIT (T337 / #1286)",
        "================================================================================",
        f"Backend Routes:  {report.total_routes} total | {report.called_routes} called | "
        f"{report.uncalled_routes} uncalled | {report.api_only_routes} API-only",
        f"Controllers:     {report.uncalled_controllers_count} controllers have NO frontend calls",
        f"Frontend Pages:  {report.total_pages} total | {report.linked_pages_count} linked | "
        f"{report.orphan_app_pages_count} orphan /app pages",
        "--------------------------------------------------------------------------------",
    ]

    if report.orphan_app_pages:
        lines.append("\n[!] ORPHAN APPLICATION PAGES (No Inbound Links or Menu Items):")
        for p in report.orphan_app_pages:
            lines.append(f"  * {p['route']:<40} -> {p['file_path']}")

    lines.append("\n[i] UNCALLED CONTROLLER ROUTES (Grouped by Controller):")
    for ctrl, endpoints in sorted(report.uncalled_by_controller.items()):
        lines.append(f"  * {ctrl} ({len(endpoints)} uncalled routes):")
        for ep in endpoints[:3]:
            lines.append(f"      - {ep['method']} {ep['url']}")
        if len(endpoints) > 3:
            lines.append(f"      ... and {len(endpoints) - 3} more")

    lines.append("\n[✓] API-ONLY CONTROLLERS (Marked Intentional Machine-to-Machine):")
    for ctrl, endpoints in sorted(report.api_only_by_controller.items()):
        reason = endpoints[0].get("reason", "API-only") if endpoints else "API-only"
        lines.append(f"  * {ctrl} ({len(endpoints)} routes) -> {reason}")

    lines.append("================================================================================")
    return "\n".join(lines)


def format_markdown(report: AuditReport) -> str:
    lines = [
        "## 🔍 Frontend Route & Orphan-Page Audit (T337 / #1286)",
        "",
        "### Overview",
        "| Metric | Count | Status |",
        "|---|---|---|",
        f"| Total Controller Endpoints | `{report.total_routes}` | Pinned in permission snapshot |",
        f"| Endpoints Called by Frontend | `{report.called_routes}` | Active UI / client consumers |",
        f"| Uncalled Backend Endpoints | `{report.uncalled_routes}` | Pending frontend implementation |",
        f"| API-Only System Endpoints | `{report.api_only_routes}` | MCP / Webhooks / Health probes |",
        f"| Total Frontend Pages | `{report.total_pages}` | App Router `page.tsx` |",
        f"| Orphan `/app/*` Pages | `{report.orphan_app_pages_count}` | Missing inbound navigation |",
        "",
        "### ⚠️ Orphan Application Pages",
        "Pages inside the authenticated app shell with no inbound link or navigation menu item:",
        "",
        "| Route | Source File | Status |",
        "|---|---|---|",
    ]

    for p in report.orphan_app_pages:
        lines.append(f"| `{p['route']}` | `{p['file_path']}` | 🔴 Orphan |")

    lines.extend([
        "",
        "### 📦 Uncalled Backend Routes by Controller",
        "Controllers on `main` awaiting dedicated frontend pages / clients:",
        "",
        "| Controller | Uncalled Routes | Sample Endpoint |",
        "|---|---|---|",
    ])

    for ctrl, eps in sorted(report.uncalled_by_controller.items()):
        sample = f"{eps[0]['method']} {eps[0]['url']}" if eps else "-"
        lines.append(f"| **{ctrl}** | `{len(eps)}` | `{sample}` |")

    lines.extend([
        "",
        "### 🛡️ Marked API-Only Flows",
        "Endpoints explicitly marked machine-to-machine / internal:",
        "",
        "| Controller | Routes | Design Purpose |",
        "|---|---|---|",
    ])

    for ctrl, eps in sorted(report.api_only_by_controller.items()):
        reason = eps[0].get("reason", "System API") if eps else "System API"
        lines.append(f"| **{ctrl}** | `{len(eps)}` | {reason} |")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit backend routes and frontend pages for uncalled APIs and orphan pages."
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Run in report-only mode (always exits with code 0).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with non-zero code if uncalled routes or orphan pages exist.",
    )
    parser.add_argument(
        "--markdown",
        action="store_true",
        help="Output results formatted in GitHub Flavored Markdown.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as a structured JSON object.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Custom repository root path (default: autodetected).",
    )
    args = parser.parse_args()

    root_dir = find_repo_root(args.root)
    try:
        report = run_audit(root_dir)
    except Exception as e:
        sys.stderr.write(f"Error executing audit: {e}\n")
        return 0 if args.report_only else 1

    if args.json:
        print(json.dumps(asdict(report), indent=2))
    elif args.markdown:
        print(format_markdown(report))
    else:
        print(format_console(report))

    if args.strict and (report.orphan_app_pages_count > 0 or report.uncalled_routes > 0):
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
