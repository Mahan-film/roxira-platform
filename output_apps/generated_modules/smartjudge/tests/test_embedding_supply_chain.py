"""Offline static scan and unit tests for #1392: embedding weights supply chain."""

import ast
import sys
import types
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SCAN_ROOTS = (REPO_ROOT / "output_apps", REPO_ROOT / "scripts")


def _is_test_file(path: Path) -> bool:
    name = path.name
    return name.startswith("test_") or name.endswith("_test.py") or "tests" in path.parts


def _iter_python_files():
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*.py")):
            if _is_test_file(p) or "__pycache__" in p.parts or "node_modules" in p.parts:
                continue
            yield p


def _kwarg_map(call: ast.Call) -> dict[str, ast.expr]:
    return {kw.arg: kw.value for kw in call.keywords if kw.arg is not None}


def _is_const_bool(node: ast.expr | None, expected: bool) -> bool:
    return isinstance(node, ast.Constant) and node.value is expected


def _dict_has_true(node: ast.expr | None, key: str) -> bool:
    if not isinstance(node, ast.Dict):
        return False
    for k, v in zip(node.keys, node.values):
        if isinstance(k, ast.Constant) and k.value == key and _is_const_bool(v, True):
            return True
    return False


def test_all_embedding_model_loads_are_pinned_and_safe():
    """Static AST scan: every SentenceTransformer / from_pretrained must pin revision, disable trust_remote_code, and force safetensors/local."""
    violations: list[str] = []
    seen_calls = 0

    for path in _iter_python_files():
        src = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(src, filename=str(path))
        except SyntaxError:
            if "SentenceTransformer" in src or "from_pretrained" in src:
                violations.append(f"{path.relative_to(REPO_ROOT)}: SyntaxError in file with model load")
            continue
        rel = path.relative_to(REPO_ROOT)

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else ""
            )
            if name not in ("SentenceTransformer", "from_pretrained"):
                continue

            seen_calls += 1
            kw = _kwarg_map(node)

            if not _is_const_bool(kw.get("trust_remote_code"), False):
                violations.append(f"{rel}:{node.lineno} {name} missing trust_remote_code=False")

            if name == "SentenceTransformer":
                if "revision" not in kw:
                    violations.append(f"{rel}:{node.lineno} SentenceTransformer missing revision=")
                if not _dict_has_true(kw.get("model_kwargs"), "use_safetensors"):
                    violations.append(
                        f"{rel}:{node.lineno} SentenceTransformer missing model_kwargs={{'use_safetensors': True}}"
                    )
            else:  # from_pretrained
                target = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else ""
                is_local = _is_const_bool(kw.get("local_files_only"), True)
                if "revision" not in kw and not is_local:
                    violations.append(f"{rel}:{node.lineno} {target}.from_pretrained missing revision= or local_files_only=True")
                if "Tokenizer" not in target and not is_local:
                    if not _is_const_bool(kw.get("use_safetensors"), True):
                        violations.append(f"{rel}:{node.lineno} {target}.from_pretrained missing use_safetensors=True")

    assert seen_calls >= 10, f"expected >=10 model load calls, found {seen_calls}"
    assert not violations, "Unpinned/unsafe model load(s):\n" + "\n".join(violations)


def test_lightrag_engine_passes_pinned_revision_and_safetensors(monkeypatch):
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

    captured: dict = {}

    class _FakeST:
        def __init__(self, model_name, **kwargs):
            captured["model_name"] = model_name
            captured["kwargs"] = kwargs

    fake_mod = types.ModuleType("sentence_transformers")
    fake_mod.SentenceTransformer = _FakeST
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_mod)
    monkeypatch.setattr(eng, "_embedder_instance", None)
    monkeypatch.setattr(eng, "_embedder_load_failed", False)
    monkeypatch.delenv("EMBED_MODEL_REVISION", raising=False)

    inst = eng._get_query_embedder()
    assert inst is not None
    assert captured["model_name"] == "BAAI/bge-m3"
    assert captured["kwargs"]["revision"] == "5617a9f61b028005a4858fdac845db406aefb181"
    assert captured["kwargs"]["trust_remote_code"] is False
    assert captured["kwargs"]["model_kwargs"] == {"use_safetensors": True}
