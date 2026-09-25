"""W11 Project Factory: owner brief -> W9 research -> Persian proposal ->
owner approval -> planner -> W10 agents build -> PR -> CI -> merge.

This package holds the pure, side-effect-free logic (command parsing, plan
validation, slugging, allowlist checks, prompt/comment building) so it can be
unit tested directly under `pytest -m "not integration"` (see pyproject.toml
`testpaths = ["src"]`). The scripts that actually talk to GitHub, OpenRouter
or git live next to the W10 agent runner in
`output_apps/ecosystem_core/src/factory/` and import from here.

Design: docs/STRATEGY.md section 8, docs/PROJECT_FACTORY.md.
"""

from __future__ import annotations
