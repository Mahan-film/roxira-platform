"""Offline tests for next_migration_id.py and the --open-prs part of check_migration_ids.py (#1283).

No import-time side effects (lesson 33): the scripts run as subprocesses against throwaway git repos,
and `gh` is a stub executable that prints a recorded-shape JSON fixture (no network, no real PRs).
Run only this file: python3 -m unittest scripts/dev/test_next_migration_id.py
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECK = HERE / "check_migration_ids.py"
NEXT = HERE / "next_migration_id.py"
CLAIM = HERE / "claim.sh"
MIG = "output_apps/enterprise_hub/migrations"

# Shape of `gh pr list --json number,headRefName,files`, sanitised (generic branch names).
# Today's evidence: #1192 and #1271 carry the same file, #1242 uses the same id for another file.
STUB = """#!{python}
import os, sys
mode = os.environ.get("FAKE_GH_MODE", "ok")
if sys.argv[1:3] != ["pr", "list"]:
    sys.exit(3)
if mode == "fail":
    sys.stderr.write("error connecting to api.github.com\\n")
    sys.exit(1)
if mode == "garbage":
    print("<html>not json</html>")
    sys.exit(0)
sys.stdout.write(open(os.environ["FAKE_GH_JSON"]).read())
"""


def pr(number, branch, *paths):
    return {"number": number, "headRefName": branch, "files": [{"path": p} for p in paths]}


def mig(name):
    return f"{MIG}/{name}"


ADD_SYSTEM = "1789900022000-AddSystemPostedOnlyToChartOfAccounts.ts"
CREATE_COUNTERS = "1789900022000-CreateDocumentCounters.ts"
FIXTURE = [
    pr(1192, "lane/a", mig(ADD_SYSTEM), "output_apps/enterprise_hub/modules/accounting/x.spec.ts"),
    pr(1271, "lane/b", mig(ADD_SYSTEM)),
    pr(1242, "lane/c", mig(CREATE_COUNTERS)),
    pr(1300, "lane/d", "docs/readme.md"),
    pr(1301, "lane/e", "other/dir/1789900099000-NotAMigration.ts"),
]


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp = Path(self._tmp.name)
        self.bin = tmp / "bin"
        self.bin.mkdir()
        gh = self.bin / "gh"
        gh.write_text(STUB.format(python=sys.executable))
        gh.chmod(gh.stat().st_mode | stat.S_IXUSR)
        self.fixture = tmp / "prs.json"
        self.set_prs(FIXTURE)
        self.env = {
            k: v for k, v in os.environ.items()
            if not k.startswith(("GIT_", "GITHUB_", "GH_", "FAKE_"))
        }
        self.env.update(
            PATH=f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
            FAKE_GH_JSON=str(self.fixture),
            GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t",
        )
        self.repo = tmp / "r"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.write("1789000000000", "A")
        self.write("1789900021000", "B")  # newest id on main
        self.commit()
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("switch", "-q", "-c", "feat")

    def set_prs(self, prs):
        self.fixture.write_text(json.dumps(prs))

    def git(self, *a):
        subprocess.run(["git", *a], cwd=self.repo, check=True, capture_output=True, env=self.env)

    def write(self, mid, name):
        p = self.repo / MIG / f"{mid}-{name}.ts"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"export class {name}{mid} {{\n  name = '{name}{mid}';\n}}\n")

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "x")

    def run_script(self, script, *args, **extra_env):
        env = dict(self.env, **extra_env)
        p = subprocess.run([sys.executable, str(script), "--repo", str(self.repo), *args],
                           capture_output=True, text=True, env=env)
        return p.returncode, p.stdout, p.stderr

    def check(self, *args, **extra_env):
        return self.run_script(CHECK, "--open-prs", *args, **extra_env)


class OpenPrCheck(Base):
    def add(self, name):
        self.write(name[:13], name[14:-3])
        self.commit()

    def test_collision_with_a_different_file_fails_and_names_the_pr(self):
        self.add("1789900022000-MyThing.ts")
        code, out, _ = self.check()
        self.assertEqual(code, 1)
        self.assertIn("PR #1192", out)
        self.assertIn("PR #1242", out)

    def test_stacked_pr_with_the_identical_file_is_allowed(self):
        self.add(ADD_SYSTEM)
        self.set_prs([FIXTURE[0], FIXTURE[1]])  # #1192 and #1271 carry this very file
        code, out, _ = self.check()
        self.assertEqual((code, "passed" in out), (0, True), out)

    def test_identical_file_still_fails_against_another_file_with_the_same_id(self):
        self.add(ADD_SYSTEM)
        code, out, _ = self.check()  # fixture also has #1242 with CreateDocumentCounters
        self.assertEqual(code, 1)
        self.assertIn("PR #1242", out)
        self.assertNotIn("PR #1192", out)
        self.assertNotIn("PR #1271", out)

    def test_id_below_main_fails_even_when_no_open_pr_uses_it(self):
        self.add("1789000500000-Low.ts")
        code, out, _ = self.check()
        self.assertEqual(code, 1)
        self.assertIn("1789000500000-Low.ts", out)
        self.assertIn("1789900022000", out)  # the suggested id above main's newest

    def test_unused_id_above_everything_passes(self):
        self.add("1789900077000-Fresh.ts")
        self.assertEqual(self.check()[0], 0)

    def test_own_pr_is_left_out_by_branch_name(self):
        # The PR head still has the old file name for the same id; only the branch tells us it is ours.
        self.add("1789900077000-Fresh.ts")
        self.set_prs([pr(1400, "feat", mig("1789900077000-OldName.ts"))])
        self.assertEqual(self.check()[0], 0)  # branch read from git
        self.git("switch", "-q", "--detach")  # a pull_request checkout is detached
        self.assertEqual(self.check()[0], 1)  # "HEAD" matches nothing: the PR clashes with itself
        self.assertEqual(self.check(GITHUB_HEAD_REF="feat")[0], 0)
        self.assertEqual(self.check("--own-branch", "feat")[0], 0)

    def test_unreachable_github_warns_locally_and_exits_zero(self):
        self.add("1789900022000-MyThing.ts")
        code, out, err = self.check(FAKE_GH_MODE="fail")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", err)
        self.assertIn("error connecting", err)

    def test_unreachable_github_fails_when_required(self):
        self.add("1789900022000-MyThing.ts")
        code, out, _ = self.check("--require-open-prs", FAKE_GH_MODE="fail")
        self.assertEqual(code, 1)
        self.assertIn("could not run", out)

    def test_unreachable_github_fails_by_default_in_github_actions(self):
        self.add("1789900022000-MyThing.ts")
        code, _out, _ = self.check(FAKE_GH_MODE="fail", GITHUB_ACTIONS="true")
        self.assertEqual(code, 1)

    def test_non_json_gh_output_counts_as_unreachable(self):
        self.add("1789900077000-Fresh.ts")
        code, _out, err = self.check(FAKE_GH_MODE="garbage")
        self.assertEqual((code, "WARNING" in err), (0, True))
        self.assertEqual(self.check("--require-open-prs", FAKE_GH_MODE="garbage")[0], 1)

    def test_without_open_prs_flag_github_is_not_asked(self):
        self.add("1789900022000-MyThing.ts")
        code, _o, _e = self.run_script(CHECK, FAKE_GH_MODE="fail")
        self.assertEqual(code, 0)  # old behaviour, local_ci.sh still uses it


class NextId(Base):
    def next(self, *args, **env):
        return self.run_script(NEXT, *args, **env)

    def test_open_pr_above_main_wins(self):
        self.set_prs(FIXTURE + [pr(1500, "lane/f", mig("1789900050000-Far.ts"))])
        code, out, err = self.next()
        self.assertEqual((code, out), (0, "1789900051000\n"), err)
        self.assertEqual(err, "")

    def test_main_wins_when_open_prs_are_lower(self):
        self.set_prs([pr(1500, "lane/f", mig("1789000100000-Old.ts"))])
        self.assertEqual(self.next()[1], "1789900022000\n")

    def test_stacked_duplicates_count_once_and_other_files_are_ignored(self):
        code, out, _ = self.next()  # FIXTURE: newest open-PR id is 1789900022000 (three files)
        self.assertEqual((code, out), (0, "1789900023000\n"))

    def test_no_open_prs(self):
        self.set_prs([])
        self.assertEqual(self.next()[1], "1789900022000\n")

    def test_unreachable_github_uses_main_and_warns_on_stderr(self):
        code, out, err = self.next(FAKE_GH_MODE="fail")
        self.assertEqual((code, out), (0, "1789900022000\n"))
        self.assertIn("WARNING", err)
        self.assertIn("origin/main only", err)

    def test_unreachable_github_is_an_error_when_required(self):
        code, out, err = self.next("--require-open-prs", FAKE_GH_MODE="fail")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("WARNING", err)

    def test_the_printed_id_passes_the_check_with_open_prs(self):
        self.set_prs(FIXTURE + [pr(1500, "lane/f", mig("1789900050000-Far.ts"))])
        nid = self.next()[1].strip()
        self.write(nid, "Mine")
        self.commit()
        self.assertEqual(self.check()[0], 0)


class ClaimScript(unittest.TestCase):
    def test_claim_sh_is_valid_bash_and_prints_the_id_without_failing_a_claim(self):
        self.assertEqual(subprocess.run(["bash", "-n", str(CLAIM)]).returncode, 0)
        text = CLAIM.read_text()
        self.assertIn("next_migration_id.py", text)
        self.assertIn("if nmid=", text)  # the lookup sits in an `if`, so set -e cannot abort a claim


if __name__ == "__main__":
    unittest.main()
