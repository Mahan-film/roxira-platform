"""Offline tests for email_offsite.py. Run only this file:
python3 -m pytest scripts/ops/backup/test_backup_email.py -q
No network, no real SMTP."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import email_offsite as eo  # noqa: E402


def age_file(d: Path, size: int, name="payload.tar.age") -> Path:
    p = d / name
    p.write_bytes(eo.AGE_MAGIC + b"\n" + os.urandom(max(size - len(eo.AGE_MAGIC) - 1, 0)))
    return p


class FakeSMTP:
    instances = []

    def __init__(self):
        self.sent, self.logged_in, self.tls = [], None, False
        FakeSMTP.instances.append(self)

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self, context=None): self.tls = True
    def login(self, u, p): self.logged_in = (u, p)
    def send_message(self, m): self.sent.append(m)


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_split_boundaries(self):
        for size, pb, n in [(100, 100, 1), (101, 100, 2), (300, 100, 3), (1, 100, 1)]:
            src = age_file(self.d, max(size, 22), f"s{size}.age") if size > 21 else None
            if src is None:
                src = self.d / "tiny.age"; src.write_bytes(b"x")
            parts = eo.split_file(src, self.d / f"o{size}_{pb}", pb)
            self.assertEqual(len(parts), n)
            self.assertTrue(all(p.size <= pb for p in parts))
            self.assertEqual(sum(p.size for p in parts), src.stat().st_size)
            self.assertEqual(parts[0].name, f"{src.name}.part01")

    def test_empty_and_too_many_parts(self):
        e = self.d / "e.age"; e.write_bytes(b"")
        with self.assertRaises(eo.OffsiteError):
            eo.split_file(e, self.d / "o", 10)
        big = self.d / "b.age"; big.write_bytes(b"a" * 1000)
        with self.assertRaises(eo.OffsiteError):
            eo.split_file(big, self.d / "o2", 5)

    def test_roundtrip_and_manifest_checksums(self):
        src = age_file(self.d, 1000)
        caps = eo.Caps(part_bytes=300)
        manifest, parts = eo.plan_offsite(src, self.d / "w", "2026-10-12", "h", caps)
        self.assertEqual(manifest["status"], "OK")
        self.assertEqual(len(manifest["parts"]), 4)
        for mp, p in zip(manifest["parts"], parts):
            self.assertEqual(mp["sha256"], hashlib.sha256(Path(p.path).read_bytes()).hexdigest())
        out = self.d / "joined"
        sha = eo.join_parts([Path(p.path) for p in parts], out)
        self.assertEqual(sha, manifest["source"]["sha256"])
        self.assertEqual(out.read_bytes(), src.read_bytes())

    def test_refuses_plaintext(self):
        p = self.d / "plain.sql"; p.write_bytes(b"INSERT INTO users ...")
        with self.assertRaises(eo.OffsiteError):
            eo.plan_offsite(p, self.d / "w", "d", "h", eo.Caps())

    def test_cap_enforcement_mail_count(self):
        src = age_file(self.d, 1000)
        caps = eo.Caps(part_bytes=100, max_mails=5, max_day_bytes=10**9)
        manifest, parts = eo.plan_offsite(src, self.d / "w", "d", "h", caps)
        self.assertEqual(manifest["status"], "OVER_CAP")
        self.assertEqual(parts, [])
        self.assertIn("per-run cap", manifest["note"])
        self.assertFalse((self.d / "w").exists())  # nothing was split

    def test_cap_enforcement_daily_bytes(self):
        src = age_file(self.d, 1000)
        caps = eo.Caps(part_bytes=500, max_mails=10, max_day_bytes=1500)
        self.assertIsNone(eo.check_caps(1000, 2, caps, 0))
        self.assertIn("daily cap", eo.check_caps(1000, 2, caps, 600))
        m, parts = eo.plan_offsite(src, self.d / "w", "d", "h", caps, sent_today=600)
        self.assertEqual(m["status"], "OVER_CAP")

    def test_part_size_too_big_for_gmail(self):
        self.assertIn("25 MB", eo.check_caps(10, 1, eo.Caps(part_bytes=20 * eo.MB)))
        self.assertIsNone(eo.check_caps(10, 1, eo.Caps()))  # default 17 MB fits

    def test_day_state(self):
        p = self.d / "s.json"
        self.assertEqual(eo.read_day_state(p, "2026-10-12")["bytes"], 0)
        eo.write_day_state(p, {"date": "2026-10-12", "bytes": 7, "mails": 1})
        self.assertEqual(eo.read_day_state(p, "2026-10-12")["bytes"], 7)
        self.assertEqual(eo.read_day_state(p, "2026-10-13")["bytes"], 0)

    def test_messages_and_mock_smtp(self):
        src = age_file(self.d, 700)
        caps = eo.Caps(part_bytes=300)
        manifest, parts = eo.plan_offsite(src, self.d / "w", "2026-10-12", "h", caps)
        msgs = eo.offsite_messages(manifest, parts, "a@x.test", "b@x.test")
        self.assertEqual(len(msgs), 3)
        names = [[x.get_filename() for x in m.iter_attachments()] for m in msgs]
        self.assertEqual(names[1], ["offsite-manifest-2026-10-12.json", f"{src.name}.part02"])
        self.assertIn("part 02/03", msgs[1]["Subject"])
        FakeSMTP.instances.clear()
        slept = []
        n = eo.send_messages(msgs, FakeSMTP, "u", "p", pause_s=2, sleep=slept.append)
        self.assertEqual(n, 3)
        s = FakeSMTP.instances[0]
        self.assertTrue(s.tls)
        self.assertEqual(s.logged_in, ("u", "p"))
        self.assertEqual(len(s.sent), 3)
        self.assertEqual(slept, [2, 2])
        att = [x for x in s.sent[0].iter_attachments() if x.get_filename().endswith("part01")][0]
        self.assertEqual(att.get_content_type(), "application/octet-stream")
        self.assertEqual(att.get_content(), Path(parts[0].path).read_bytes())

    def test_report_md_and_manifest(self):
        sets = self.d / "sets" / "20261012T000700Z"
        sets.mkdir(parents=True)
        (sets / "a.dump").write_bytes(b"abc")
        (self.d / "sets" / "latest").symlink_to(sets)
        scanned = eo.scan_sets(self.d / "sets", 1024)
        self.assertEqual(scanned[0]["files"][0]["sha256"], hashlib.sha256(b"abc").hexdigest())
        st = eo.parse_status_env("LAST_RESULT='OK'\nSTAGE_BYTES='3'\nSNAP_sftp='abc12345'\nADDED_sftp='1 KiB'\n")
        m = eo.build_report_manifest("2026-10-12", "h", st, scanned, 40, eo.Caps(),
                                     {"status": "OVER_CAP", "note": "too big", "parts": []})
        md = eo.render_report_md(m)
        self.assertIn("# Roxira backup report 2026-10-12", md)
        self.assertIn("OVER_CAP", md)
        self.assertIn(hashlib.sha256(b"abc").hexdigest(), md)
        json.dumps(m)

    def _report(self, set_name, status_text, now):
        d = Path(tempfile.mkdtemp(dir=self.d))
        (d / set_name).mkdir()
        (d / "latest").symlink_to(d / set_name)
        sets = eo.scan_sets(d, 1024)
        st = eo.parse_status_env(status_text)
        fresh = eo.freshness(sets, st, now, 30, 3, 192)
        return eo.build_report_manifest("2026-10-30", "h", st, sets, 40, eo.Caps(), None, fresh)

    def test_stale_set_fails_and_says_age(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 30, 6, 30, tzinfo=timezone.utc)
        m = self._report("20261022T000700Z", "LAST_RESULT='OK'\nBACKUP_MODE='local-only'\n", now)
        self.assertEqual(m["status"], "STALE")
        self.assertGreater(m["freshness"]["set_age_h"], 190)
        md = eo.render_report_md(m)
        self.assertIn("20261022T000700Z", md)
        self.assertIn("old, limit 30 h", md)
        self.assertIn("ATTENTION", md)

    def test_fresh_set_passes_and_local_only_hides_restic_check(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 30, 6, 30, tzinfo=timezone.utc)
        m = self._report("20261030T010700Z", "LAST_RESULT='OK'\nBACKUP_MODE='local-only'\n", now)
        self.assertEqual(m["status"], "OK")
        self.assertIsNone(m["restic_check"])
        self.assertIn("not applicable (local-only", eo.render_report_md(m))

    def test_restic_mode_keeps_restic_check(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 30, 6, 30, tzinfo=timezone.utc)
        m = self._report("20261030T010700Z", "LAST_RESULT='OK'\nBACKUP_MODE='restic'\nCHECK_RESULT='OK'\n", now)
        self.assertEqual(m["restic_check"]["result"], "OK")

    def test_r2_and_drill_staleness(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 30, 6, 30, tzinfo=timezone.utc)
        ok = "LAST_RESULT='OK'\nBACKUP_MODE='local-only'\n"
        m = self._report("20261030T010700Z", ok + "R2_LAST_RESULT='OK'\nR2_LAST_OK='20261030T060000Z'\n"
                         "DRILL_RESULT='OK'\nDRILL_AT='20261026T050000Z'\n", now)
        self.assertEqual(m["status"], "OK")
        m = self._report("20261030T010700Z", ok + "R2_LAST_RESULT='OK'\nR2_LAST_OK='20261030T010000Z'\n", now)
        self.assertEqual(m["status"], "STALE")
        m = self._report("20261030T010700Z", ok + "DRILL_RESULT='FAIL'\nDRILL_AT='20261030T050000Z'\n", now)
        self.assertIn("restore drill FAILED", m["freshness"]["problems"][0])

    def test_missing_results_fail_when_expected(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 30, 6, 30, tzinfo=timezone.utc)
        d = Path(tempfile.mkdtemp(dir=self.d))
        (d / "20261030T010700Z").mkdir()
        (d / "latest").symlink_to(d / "20261030T010700Z")
        sets = eo.scan_sets(d, 1024)
        st = eo.parse_status_env("LAST_RESULT='OK'\nBACKUP_MODE='local-only'\n")
        quiet = eo.freshness(sets, st, now, 30, 3, 192)
        self.assertEqual(quiet["problems"], [])  # features not installed: nothing expected
        loud = eo.freshness(sets, st, now, 30, 3, 192, expect_r2=True, expect_drill=True)
        self.assertEqual(len(loud["problems"]), 2)
        m = eo.build_report_manifest("2026-10-30", "h", st, sets, 40, eo.Caps(), None, loud)
        self.assertEqual(m["status"], "STALE")

    def test_report_message_utf8_filenames(self):
        m = eo.make_message("تست", "سلام", "a@x.test", "b@x.test", [("backup-report-d.md", "# سلام".encode())])
        att = next(m.iter_attachments())
        self.assertEqual(att.get_content_type(), "text/markdown")
        self.assertEqual(att.get_content().strip(), "# سلام")
        m.as_bytes()  # serialises


if __name__ == "__main__":
    unittest.main()
