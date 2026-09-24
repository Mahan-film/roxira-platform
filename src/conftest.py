"""Test selection for CI.

CI runs `pytest -m "not integration"`: only pure unit tests that need no live service.
- Files in src/ci_quarantine.py are never collected (importing them has side effects).
- Real tests that need Postgres, Qdrant, LLM keys or the network: decorate them with
  `@pytest.mark.integration` so CI skips them.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "ci_quarantine", Path(__file__).with_name("ci_quarantine.py")
)
_quarantine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_quarantine)

collect_ignore: list[str] = list(_quarantine.IGNORED)
