"""Offline tests for retention.py. Run only this file:
python3 -m unittest scripts/ops/backup/test_retention.py (or: cd scripts/ops/backup && python3 test_retention.py)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retention as r  # noqa: E402


def hourly_names(day: str, hours):
    return [f"{day}T{h:02d}0700Z" for h in hours]


class SelectDelete(unittest.TestCase):
    def test_empty_and_foreign_names(self):
        self.assertEqual(r.select_delete([], 6, 3), [])
        self.assertEqual(r.select_delete(["latest", "stage", "x"], 6, 3), [])

    def test_hourly_window_plus_daily(self):
        names = []
        for day in ("20261008", "20261009", "20261010", "20261011"):
            names += hourly_names(day, range(24))
        # keep: newest 6 of 20261011 (18..23) + newest per day for 3 newest days
        # (20261011 T23 already kept, 20261010 T23, 20261009 T23)
        dele = set(r.select_delete(names, 6, 3))
        kept = set(names) - dele
        self.assertEqual(
            kept,
            set(hourly_names("20261011", range(18, 24)))
            | {"20261010T230700Z", "20261009T230700Z"},
        )

    def test_newest_always_kept(self):
        names = hourly_names("20261011", range(5))
        self.assertEqual(r.select_delete(names, 0, 0), names[:-1])

    def test_only_latest_mode(self):
        names = hourly_names("20261010", range(3)) + hourly_names("20261011", range(3))
        self.assertEqual(set(names) - set(r.select_delete(names, 1, 0)), {"20261011T020700Z"})

    def test_fewer_than_window_deletes_nothing(self):
        names = hourly_names("20261011", range(4))
        self.assertEqual(r.select_delete(names, 6, 3), [])

    def test_gap_days_count_days_with_sets_only(self):
        names = ["20261001T010000Z", "20261005T010000Z", "20261011T010000Z", "20261011T020000Z"]
        dele = r.select_delete(names, 1, 3)
        self.assertEqual(dele, ["20261011T010000Z"])  # newest of each of the 3 days present is kept

    def test_daily_uses_newest_of_day(self):
        names = ["20261010T010000Z", "20261010T230000Z", "20261011T120000Z"]
        self.assertEqual(r.select_delete(names, 1, 2), ["20261010T010000Z"])


class Cli(unittest.TestCase):
    def test_cli_lists_only_set_dirs(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            for n in hourly_names("20261011", range(8)):
                (root / n).mkdir()
            (root / "notes").mkdir()
            (root / "20261011T000000Z.txt").write_text("x")
            (root / "latest").symlink_to(root / "20261011T070700Z")
            import io
            from contextlib import redirect_stdout
            buf = io.StringIO()
            with redirect_stdout(buf):
                r.main([t, "--hourly", "6", "--daily", "0"])
            self.assertEqual(buf.getvalue().split(), ["20261011T000700Z", "20261011T010700Z"])


if __name__ == "__main__":
    unittest.main()
