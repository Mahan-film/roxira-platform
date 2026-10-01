"""Offline acceptance checks for generated project templates."""

import argparse
from pathlib import Path
import re


SKIPPED_DIRS = {"node_modules", ".next", ".git"}
SECRET_PATTERNS = tuple(map(re.compile, (r"sk-[A-Za-z0-9]{20,}",
    r"ghp_[A-Za-z0-9]{20,}", r"AKIA[0-9A-Z]{16}")))
CREATE_TABLE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w\".]+)\s*\((.*?)\);",
    re.IGNORECASE | re.DOTALL,
)


def _files(root: Path):
    for path in root.rglob("*"):
        if path.is_file() and not any(part in SKIPPED_DIRS for part in path.parts):
            yield path


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def check_project(root: Path) -> list[str]:
    problems: list[str] = []
    files = list(_files(root))

    for path in files:
        relative = _relative(path, root)
        text = path.read_text(encoding="utf-8", errors="ignore")
        if path.suffix == ".tsx" and path.name == "layout.tsx" and "app" in path.parts:
            if 'dir="rtl"' not in text or 'lang="fa"' not in text:
                problems.append(f'{relative}: root layout must set dir="rtl" and lang="fa"')
        if (
            (path.suffix in {".ts", ".tsx", ".js", ".jsx", ".env"} or path.name == ".env")
            and any(part in {"frontend", "web"} for part in path.parts)
            and any(pattern.search(text) for pattern in SECRET_PATTERNS)
        ):
            problems.append(f"{relative}: possible secret in frontend code")
        if path.name.endswith(".controller.ts") and "@Body(" in text:
            if not any(sibling.name.endswith(".dto.ts") for sibling in path.parent.iterdir()):
                problems.append(f"{relative}: controller takes @Body without a DTO file in the same folder")
        if path.suffix == ".sql":
            for statement in CREATE_TABLE.finditer(text):
                if not re.search(r"\b(?:tenant_id|owner_id)\b", statement.group(2), re.I):
                    problems.append(f"{relative}: table {statement.group(1)} has no tenant_id/owner_id")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check generated project templates.")
    parser.add_argument("--strict", action="store_true", help="exit 1 when problems are found")
    parser.add_argument("roots", nargs="*", metavar="ROOT", help="project roots to check")
    args = parser.parse_args(argv)

    if args.roots:
        roots = [Path(root) for root in args.roots]
    else:
        projects = Path("projects")
        if not projects.is_dir():
            print("no projects")
            return 0
        roots = sorted(path for path in projects.iterdir() if path.is_dir())

    found_problems = False
    for root in roots:
        for problem in check_project(root):
            found_problems = True
            print(f"{root}: {problem}")
    return 1 if args.strict and found_problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
