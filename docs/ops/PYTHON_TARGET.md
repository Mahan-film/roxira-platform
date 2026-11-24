# Python Target Matrix (`manylinux2014_aarch64`)

Report-only matrix for #1391 (no Dockerfile or version changes; #1309 stays HELD).

## Exact Command Used
```bash
pip download --dry-run --no-deps --only-binary=:all: \
  --platform manylinux2014_aarch64 --python-version <3.13|3.14|3.15> <package>
```

> **Note**: In the local Mac sandbox probe, `pip download --dry-run` returned non-zero for all 23 packages (no live PyPI wheel index resolution in this environment). Live CI runner verification is required to confirm `cp314` vs `cp315` wheel availability.

## Dependency Matrix (23 packages from `pyproject.toml` + C/Rust extensions)

| Package | cp313 (`3.13`) | cp314 (`3.14`) | cp315 (`3.15`) |
|---|---|---|---|
| `crawlee` | unverified (local probe non-zero) | unverified | unverified |
| `django` | unverified | unverified | unverified |
| `django-environ` | unverified | unverified | unverified |
| `django-ninja` | unverified | unverified | unverified |
| `httpx` | unverified | unverified | unverified |
| `license-expression` | unverified | unverified | unverified |
| `mypy` | unverified | unverified | unverified |
| `parsel` | unverified | unverified | unverified |
| `psycopg` | unverified | unverified | unverified |
| `pydantic` | unverified | unverified | unverified |
| `pytest` | unverified | unverified | unverified |
| `pyyaml` | unverified | unverified | unverified |
| `pytest-django` | unverified | unverified | unverified |
| `ruff` | unverified | unverified | unverified |
| `torch` | unverified | unverified | unverified |
| `onnxruntime` | unverified | unverified | unverified |
| `sentence-transformers` | unverified | unverified | unverified |
| `faiss-cpu` | unverified | unverified | unverified |
| `numpy` | unverified | unverified | unverified |
| `pydantic-core` | unverified | unverified | unverified |
| `orjson` | unverified | unverified | unverified |
| `uvloop` | unverified | unverified | unverified |
| `psycopg-binary` | unverified | unverified | unverified |

## Decision Rule
Pick the **newest** Python version (`3.15` -> fallback `3.14`) where every dependency has a `manylinux2014_aarch64` wheel (or builds in under 5 min) and CI Python tests pass.
