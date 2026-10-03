# Import boundaries (Smart Judge vs Roxira)

Phase 1 of a future split of Smart Judge from the Roxira platform. Nothing is
moved or deleted; this only stops the two products from growing new coupling.

## Products

Defined in `config/import_boundaries.json` (JSON, stdlib-parsed):

| Product | Paths |
|---|---|
| `smart_judge` | `output_apps/smart_judge`, `output_apps/generated_modules/smartjudge` |
| `roxira` | `output_apps/ecosystem_core/src/{accounting,banking,crm,inventory,payroll,treasury,compliance,trading}`, `output_apps/enterprise_hub` (excluding `frontend/`) |
| `core` | `output_apps/ecosystem_core/src/{billing,notifications,auth}`, `output_apps/generated_modules/unifiedauth`, `src/roxira_config.py` |

Files outside these paths (for example `ecosystem_core/src/factory`,
`ecosystem_core/src/ingestion`, the rest of `src/`) belong to no product and are
not checked. `core` may be imported by anyone.

## Rule

`smart_judge` and `roxira` must not import each other, except for the exact
`from file -> to file` pairs in `allowed_edges` (the baseline). Detected:
`import`, `from ... import` (absolute and relative), and string literals that
are repo-relative paths to an existing `.py` file (path-based dynamic loading).

## Usage

```
python3 scripts/ci/check_import_boundaries.py                  # report; exit 1 on NEW edges
python3 scripts/ci/check_import_boundaries.py --write-baseline # regenerate allowed_edges
```

The script parses with `ast` and never imports scanned code. Output lists NEW
edges (with line numbers) and STALE baseline entries that can be dropped.

Tests: `python3 -m pytest src/ops/test_import_boundaries.py`.

## Baseline

Currently 1 allowed edge:
`output_apps/ecosystem_core/src/banking/sayad_check_engine.py` -> `output_apps/smart_judge/src/engines/legal_drafter.py`
(loaded via `dynamic_import`). Removing this coupling is a Phase 2 task.

## Not yet wired

The checker is not yet a step in `.github/workflows/ci.yml`; adding it is a
separate reviewed change.
