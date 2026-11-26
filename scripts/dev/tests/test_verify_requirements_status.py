"""Offline unit tests for scripts/dev/verify_requirements_status.py."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.dev import verify_requirements_status as vrs


SAMPLE_VALID_MD = """# Requirements status

| Code | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| E-02 | Chart | done | `output_apps/enterprise_hub/modules/accounting/dimensions.pg.spec.ts` | |
| PTY-01 | Parties | partial | `GET /enterprise-hub/parties`, `output_apps/enterprise_hub/modules/parties/` | Page at `/app/import` |
"""


class VerifyRequirementsStatusTests(unittest.TestCase):
    def test_is_repo_path_token_filters_routes_and_globs(self) -> None:
        self.assertTrue(vrs.is_repo_path_token("output_apps/enterprise_hub/modules/accounting/money.ts"))
        self.assertTrue(vrs.is_repo_path_token("docs/help/fa/21-chart-of-accounts.md"))
        self.assertFalse(vrs.is_repo_path_token("/app/invoicing"))
        self.assertFalse(vrs.is_repo_path_token("GET /enterprise-hub/parties"))
        self.assertFalse(vrs.is_repo_path_token("modules/*/*.tenant.spec.ts"))
        self.assertFalse(vrs.is_repo_path_token("vat_general_rate"))
        self.assertFalse(vrs.is_repo_path_token("origin/main"))
        self.assertFalse(vrs.is_repo_path_token(".../reconciliation"))

    def test_split_markdown_row_preserves_escaped_pipes(self) -> None:
        row = r"| T1 | Roles | done | `a \| b`, `spec.pg.spec.ts` | notes |"
        cols = vrs.split_markdown_row(row)
        self.assertEqual(len(cols), 5)
        self.assertIn("spec.pg.spec.ts", cols[3])

    def test_verify_document_passes_when_paths_exist_and_done_has_spec(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "REQUIREMENTS_STATUS.md"
            doc.write_text(SAMPLE_VALID_MD, encoding="utf-8")
            with mock.patch.object(vrs, "git_path_exists", return_value=True):
                errors = vrs.verify_document(doc, "origin/main")
            self.assertEqual(errors, [])

    def test_verify_document_flags_missing_path_and_untested_done_row(self) -> None:
        bad_md = """| Code | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| T99 | Something | done | `output_apps/enterprise_hub/modules/fake/missing.ts` | |
"""
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "REQUIREMENTS_STATUS.md"
            doc.write_text(bad_md, encoding="utf-8")
            with mock.patch.object(vrs, "git_path_exists", return_value=False):
                errors = vrs.verify_document(doc, "origin/main")
            self.assertEqual(len(errors), 2)
            self.assertIn("missing `output_apps/enterprise_hub/modules/fake/missing.ts`", errors[0])
            self.assertIn("cites no test/spec file", errors[1])


if __name__ == "__main__":
    unittest.main()
