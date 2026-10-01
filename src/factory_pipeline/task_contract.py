from dataclasses import dataclass
from itertools import combinations
from pathlib import PurePosixPath

from src.factory_pipeline.plan_parsing import PlanValidationError

ALLOWED_AREAS = ("frontend", "backend", "database", "tests", "infra", "docs")


@dataclass(frozen=True)
class TaskContract:
    area: str
    allowed_paths: tuple[str, ...]
    needs_migration: bool
    test_command: str


def parse_contract(raw: dict) -> TaskContract:
    contract = raw.get("contract")
    if not isinstance(contract, dict):
        raise PlanValidationError("task contract is required")
    area, paths = contract.get("area"), contract.get("allowed_paths")
    command, migration = contract.get("test_command"), contract.get("needs_migration")
    if area not in ALLOWED_AREAS:
        raise PlanValidationError("task contract area is invalid")
    if not isinstance(paths, list) or not paths or any(not _valid_path(path) for path in paths):
        raise PlanValidationError("task contract allowed_paths is invalid")
    if not isinstance(command, str) or not command.strip():
        raise PlanValidationError("task contract test_command is required")
    if not isinstance(migration, bool):
        raise PlanValidationError("task contract needs_migration must be a boolean")
    return TaskContract(area, tuple(paths), migration, command)


def _valid_path(path: object) -> bool:
    if not isinstance(path, str) or not path or PurePosixPath(path).is_absolute():
        return False
    return ".." not in PurePosixPath(path).parts and not path.startswith(
        (".env", "data/", "database_snapshots/"))


def paths_overlap(a: TaskContract, b: TaskContract) -> bool:
    return any(_prefix(left, right) or _prefix(right, left)
               for left in a.allowed_paths for right in b.allowed_paths)


def _prefix(prefix: str, path: str) -> bool:
    parts = PurePosixPath(prefix).parts
    return PurePosixPath(path).parts[:len(parts)] == parts


def parallel_safe(contracts: list[TaskContract]) -> bool:
    return (sum(contract.needs_migration for contract in contracts) <= 1
            and all(not paths_overlap(a, b) for a, b in combinations(contracts, 2)))
