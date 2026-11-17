"""Offline tests for r2_tools.py: SigV4 against the AWS documentation vector, and the retention rule."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import r2_tools as r2  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


class SigV4(unittest.TestCase):
    def test_aws_docs_vector(self):
        # "GET Object with Range header" example from the AWS Signature V4 documentation.
        h = r2.sign_request(
            "GET", "examplebucket.s3.amazonaws.com", "/test.txt", {}, {"Range": "bytes=0-9"}, r2.EMPTY_SHA,
            "us-east-1", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "20130524T000000Z")
        self.assertTrue(h["authorization"].endswith(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"))
        self.assertIn("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date", h["authorization"])


class Prune(unittest.TestCase):
    def k(self, kind, ts):
        return f"pgcfg/{kind}/{ts}.tar.age"

    def test_hourly_7_days_daily_30_days(self):
        keys = [self.k("hourly", "20261030T110000Z"),   # 1h old: keep
                self.k("hourly", "20261024T130000Z"),   # 5.9d: keep
                self.k("hourly", "20261023T110000Z"),   # 7.04d: delete
                self.k("daily", "20261001T030000Z"),    # 29d: keep
                self.k("daily", "20260929T030000Z"),    # 31d: delete
                "pgcfg/notes.txt", "other/hourly/x.tar.age"]
        self.assertEqual(r2.select_prune(keys, NOW), [self.k("daily", "20260929T030000Z"),
                                                      self.k("hourly", "20261023T110000Z")])

    def test_newest_of_each_kind_survives_even_when_old(self):
        keys = [self.k("hourly", "20260101T000000Z"), self.k("daily", "20260101T030000Z")]
        self.assertEqual(r2.select_prune(keys, NOW), [])

    def test_unknown_names_untouched(self):
        self.assertEqual(r2.select_prune(["pgcfg/hourly/readme", "pgcfg/hourly/2020.tar.age"], NOW), [])


class Settings(unittest.TestCase):
    def test_s3_names_are_fallback(self):
        env = {"BACKUP_S3_ENDPOINT": "https://a.r2.cloudflarestorage.com", "BACKUP_S3_BUCKET": "b",
               "BACKUP_S3_ACCESS_KEY_ID": "x", "BACKUP_S3_SECRET_ACCESS_KEY": "y", "BACKUP_R2_BUCKET": "c"}
        c = r2.R2(env)
        self.assertEqual((c.bucket, c.prefix), ("c", "pgcfg"))

    def test_missing_and_non_https(self):
        with self.assertRaises(SystemExit):
            r2.R2({})
        with self.assertRaises(SystemExit):
            r2.R2({"BACKUP_R2_ENDPOINT": "http://x", "BACKUP_R2_BUCKET": "b",
                   "BACKUP_R2_ACCESS_KEY_ID": "x", "BACKUP_R2_SECRET_ACCESS_KEY": "y"})


class PrunePrefix(unittest.TestCase):
    """T197: prune --prefix qdrant --daily-days 7 touches only qdrant/daily and keeps the newest object."""

    class Fake:
        prefix, hourly_days, daily_days = "pgcfg", 7, 30
        deleted: list = []

        def __init__(self, keys):
            self.keys = keys

        def list_keys(self, prefix):
            return [k for k in self.keys if k.startswith(prefix)]

        def delete(self, key):
            self.deleted.append(key)

    def test_prefix_and_days(self):
        old = "qdrant/daily/20200101T000000Z.tar.age"
        mid = "qdrant/daily/20200102T000000Z.tar.age"
        other = "pgcfg/daily/20200101T000000Z.tar.age"
        f = self.Fake([old, mid, other])
        f.deleted = []
        self.assertEqual(r2.cmd_prune(f, False, "qdrant", None, 7), 0)
        self.assertEqual(f.deleted, [old])  # newest daily (mid) is kept, pgcfg is not touched


if __name__ == "__main__":
    unittest.main()
