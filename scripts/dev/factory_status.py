#!/usr/bin/env python3
"""Print the last N task-ledger events and the run summary (no secrets)."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.factory_pipeline.run_ledger import (
    read_events,
    summarize_days,
    task_ledger_path,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-n", type=int, default=10)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    path = task_ledger_path()
    for event in read_events(path)[-args.n:]:
        print(json.dumps(event, sort_keys=True, ensure_ascii=False))
    summary = summarize_days(args.days, path=path)
    summary.pop("per_task", None)
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
