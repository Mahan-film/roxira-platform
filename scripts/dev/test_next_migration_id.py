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

# Shape of `gh pr list --json number,changedFiles,files` (headRefName kept: it must not matter), sanitised (generic branch names).
# Today's evidence: #1192 and #1271 carry the same file, #1242 uses the same id for another file.
STUB = """#!{python}
import json, os, sys
mode = os.environ.get("FAKE_GH_MODE", "ok")
args = sys.argv[1:]
if args[:2] == ["pr", "list"]:
    if mode == "fail":
        sys.stderr.write("error connecting to api.github.com\\n")
        sys.exit(1)
    if mode == "garbage":
        print("<html>not json</html>")
        sys.exit(0)
    prs = json.load(open(os.environ["FAKE_GH_JSON"]))
    limit = int(args[args.index("--limit") + 1])
    print(json.dumps(prs[:limit]))  # gh stops at --limit, like the real one
elif args[:2] == ["pr", "view"]:
    if not os.environ.get("FAKE_GH_VIEW"):
        sys.stderr.write("no pull requests found for branch\\n")
        sys.exit(1)
    print(os.environ["FAKE_GH_VIEW"])
elif args[:1] == ["api"]:
    # gh api --paginate repos/{{owner}}/{{repo}}/pulls/N/files?per_page=100 --jq ... -> "path<TAB>sha" lines
    number = args[args.index("--paginate") + 1].split("/pulls/")[1].split("/")[0]
    f = os.path.join(os.environ.get("FAKE_GH_API_DIR", ""), number + ".tsv")
    if os.environ.get("FAKE_GH_API_MODE") == "fail" or not os.path.isfile(f):
        sys.stderr.write("HTTP 502\\n")
        sys.exit(1)
    sys.stdout.write(open(f).read())
else:
    sys.exit(3)
"""


def pr(number, branch, *paths, changed=None):
    # changedFiles is what gh reports for the whole PR; the files list is cut at 100.
    return {"number": number, "headRefName": branch, "changedFiles": changed if changed is not None else len(paths),
            "files": [{"path": p} for p in paths]}


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
        self.api = tmp / "api"
        self.api.mkdir()
        self.set_prs(FIXTURE)
        self.env = {
            k: v for k, v in os.environ.items()
            if not k.startswith(("GIT_", "GITHUB_", "GH_", "FAKE_"))
        }
        self.env.update(
            PATH=f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
            FAKE_GH_JSON=str(self.fixture), FAKE_GH_API_DIR=str(self.api),
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

    def set_api(self, number, files):
        """What `gh api .../pulls/N/files` returns for this PR: {path: blob sha}."""
        (self.api / f"{number}.tsv").write_text("".join(f"{p}\t{sha}\n" for p, sha in files.items()))

    def blob(self, mid, name):
        """Blob sha of the file `write(mid, name)` creates."""
        text = f"export class {name}{mid} {{\n  name = '{name}{mid}';\n}}\n"
        return subprocess.run(["git", "hash-object", "--stdin"], input=text, capture_output=True,
                              text=True, check=True, cwd=self.repo, env=self.env).stdout.strip()

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

    def stack_api(self, sha_1192, sha_1271=None):
        """The two PRs that carry ADD_SYSTEM, as `gh api` lists them."""
        self.set_api(1192, {mig(ADD_SYSTEM): sha_1192})
        self.set_api(1271, {mig(ADD_SYSTEM): sha_1271 or sha_1192})

    def test_collision_with_a_different_file_fails_and_names_the_pr(self):
        self.add("1789900022000-MyThing.ts")
        code, out, _ = self.check()
        self.assertEqual(code, 1)
        self.assertIn("PR #1192", out)
        self.assertIn("PR #1242", out)

    def test_stacked_pr_with_the_identical_file_is_allowed(self):
        self.add(ADD_SYSTEM)
        self.set_prs([FIXTURE[0], FIXTURE[1]])  # #1192 and #1271 carry this very file
        self.stack_api(self.blob("1789900022000", ADD_SYSTEM[14:-3]))
        code, out, _ = self.check()
        self.assertEqual((code, "passed" in out), (0, True), out)

    def test_same_path_with_different_content_fails(self):
        # Two unrelated PRs each add AddIndex with the same id and different SQL: same path, not identical.
        self.add(ADD_SYSTEM)
        self.set_prs([FIXTURE[0]])
        self.stack_api("0" * 40)
        code, out, _ = self.check()
        self.assertEqual(code, 1)
        self.assertIn("PR #1192", out)
        self.assertIn("different content", out)

    def test_same_path_content_cannot_be_read_warns_locally_and_fails_when_required(self):
        self.add(ADD_SYSTEM)
        self.set_prs([FIXTURE[0]])  # no api file for #1192: the content cannot be fetched
        code, _o, err = self.check()
        self.assertEqual((code, "cannot compare" in err), (0, True))
        code, out, _ = self.check("--require-open-prs")
        self.assertEqual((code, "cannot compare" in out), (1, True))

    def test_identical_file_still_fails_against_another_file_with_the_same_id(self):
        self.add(ADD_SYSTEM)
        self.stack_api(self.blob("1789900022000", ADD_SYSTEM[14:-3]))
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

    def test_own_pr_is_left_out_by_number(self):
        # The PR head has another file name for the same id; only the number tells us it is ours.
        self.add("1789900077000-Fresh.ts")
        self.set_prs([pr(1400, "feat", mig("1789900077000-OldName.ts"))])
        self.assertEqual(self.check()[0], 1)  # nobody told us the number: the PR clashes with itself
        self.assertEqual(self.check("--own-pr", "1400")[0], 0)
        self.assertEqual(self.check(GITHUB_REF="refs/pull/1400/merge")[0], 0)
        self.assertEqual(self.check(GITHUB_REF="refs/pull/1401/merge")[0], 1)

    def test_merge_queue_ref_names_the_own_pr(self):
        self.add("1789900077000-Fresh.ts")
        self.set_prs([pr(1400, "feat", mig("1789900077000-OldName.ts"))])
        ref = "refs/heads/gh-readonly-queue/main/pr-1400-0123456789abcdef0123456789abcdef01234567"
        self.assertEqual(self.check(GITHUB_REF=ref)[0], 0)

    def test_local_run_asks_gh_for_the_pr_of_the_current_branch(self):
        self.add("1789900077000-Fresh.ts")
        self.set_prs([pr(1400, "feat", mig("1789900077000-OldName.ts"))])
        self.assertEqual(self.check(FAKE_GH_VIEW="1400")[0], 0)
        # In GitHub Actions without a PR ref nothing is guessed from a branch name.
        self.assertEqual(self.check(FAKE_GH_VIEW="1400", GITHUB_ACTIONS="true")[0], 1)

    def test_fork_prs_with_the_same_branch_name_do_not_hide_each_other(self):
        # Two forks both use "patch-1". Excluding by branch name would drop PR 1501 from X's run.
        self.add("1789900077000-Foo.ts")
        self.set_prs([
            pr(1500, "patch-1", mig("1789900077000-Foo.ts")),
            pr(1501, "patch-1", mig("1789900077000-Bar.ts")),
        ])
        self.set_api(1500, {mig("1789900077000-Foo.ts"): self.blob("1789900077000", "Foo")})
        code, out, _ = self.check("--own-pr", "1500")
        self.assertEqual(code, 1)
        self.assertIn("PR #1501", out)
        self.assertNotIn("PR #1500", out)

    def test_pr_with_more_than_100_files_is_read_in_full(self):
        # The migration is file 150: gh pr list cuts the list at 100, so the API list is used.
        self.add("1789900077000-Mine.ts")
        docs = [f"docs/f{i}.md" for i in range(100)]
        self.set_prs([pr(1600, "lane/big", *docs, changed=150)])
        self.set_api(1600, {mig("1789900077000-Theirs.ts"): "a" * 40})
        code, out, _ = self.check()
        self.assertEqual(code, 1)
        self.assertIn("PR #1600", out)

    def test_a_listing_of_exactly_100_files_counts_as_cut_off_without_changedfiles(self):
        self.add("1789900077000-Mine.ts")
        docs = [f"docs/f{i}.md" for i in range(100)]
        big = pr(1600, "lane/big", *docs)
        del big["changedFiles"]
        self.set_prs([big])
        self.set_api(1600, {mig("1789900077000-Theirs.ts"): "a" * 40})
        self.assertEqual(self.check()[0], 1)

    def test_a_big_pr_whose_full_list_cannot_be_read_is_unreachable(self):
        self.add("1789900077000-Mine.ts")
        self.set_prs([pr(1600, "lane/big", "docs/a.md", changed=150)])  # no api file for 1600
        code, _o, err = self.check()
        self.assertEqual((code, "more files than gh lists" in err), (0, True))
        self.assertEqual(self.check("--require-open-prs")[0], 1)

    def test_reaching_the_pr_limit_is_unreachable_not_silent(self):
        self.add("1789900077000-Fresh.ts")
        n = len(FIXTURE)
        code, _o, err = self.check("--pr-limit", str(n))  # gh would stop at n: more PRs may exist
        self.assertEqual((code, "lookup limit" in err), (0, True))
        code, out, _ = self.check("--pr-limit", str(n), "--require-open-prs")
        self.assertEqual((code, "lookup limit" in out), (1, True))
        self.assertEqual(self.check("--pr-limit", str(n + 1), "--require-open-prs")[0], 0)

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

    def test_merge_queue_catches_a_pr_that_appeared_after_the_pr_run(self):
        # Time-of-check: A passed when B had no migration. Later B pushes the same id with another
        # file. The merge_group run of A (own number from the queue ref) sees B open and fails.
        self.add("1789900077000-Foo.ts")
        self.set_prs([pr(1500, "a", mig("1789900077000-Foo.ts"))])
        ref = "refs/heads/gh-readonly-queue/main/pr-1500-0123456789abcdef0123456789abcdef01234567"
        self.assertEqual(self.check(GITHUB_REF=ref)[0], 0)  # the PR run: B not there yet
        self.set_prs([pr(1500, "a", mig("1789900077000-Foo.ts")), pr(1501, "b", mig("1789900077000-Bar.ts"))])
        code, out, _ = self.check(GITHUB_REF=ref)  # the merge_group run
        self.assertEqual(code, 1)
        self.assertIn("PR #1501", out)


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


    def test_a_migration_beyond_file_100_of_a_big_pr_counts(self):
        self.set_prs([pr(1600, "lane/big", "docs/a.md", changed=150)])
        self.set_api(1600, {mig("1789900060000-Late.ts"): "a" * 40})
        self.assertEqual(self.next()[1], "1789900061000\n")

    def test_reaching_the_pr_limit_warns(self):
        code, out, err = self.next("--pr-limit", str(len(FIXTURE)))
        self.assertEqual((code, out), (0, "1789900022000\n"))
        self.assertIn("lookup limit", err)


class GateJob(unittest.TestCase):
    """The ci.yml `migration-gate` job: always runs, so it can be a required check (the ruleset
    cannot require migration-lint, which is skipped when no migration changed)."""

    CI = HERE.parent.parent / ".github" / "workflows" / "ci.yml"

    def block(self):
        text = self.CI.read_text()
        start = text.index("\n  migration-gate:\n")
        end = text.index("\n  frontend:\n", start)
        return text[start:end]

    def script(self):
        lines = self.block().splitlines()
        i = lines.index("        run: |")
        return "\n".join(ln[10:] for ln in lines[i + 1:])

    def run_gate(self, changes="success", lint="success", migrations="true", event="pull_request"):
        env = dict(os.environ, CHANGES_RESULT=changes, LINT_RESULT=lint,
                   MIGRATIONS_CHANGED=migrations, EVENT=event)
        return subprocess.run(["bash", "-c", self.script()], env=env, capture_output=True, text=True).returncode

    def test_job_always_runs_and_needs_the_lint_job(self):
        b = self.block()
        self.assertIn("name: Migration gate", b)
        self.assertIn("needs: [pick-runner, changes, migration-lint]", b)
        self.assertIn("if: always()", b)

    def test_lint_failure_or_cancel_fails_the_gate(self):
        self.assertEqual(self.run_gate(lint="success"), 0)
        self.assertEqual(self.run_gate(lint="failure"), 1)
        self.assertEqual(self.run_gate(lint="cancelled"), 1)

    def test_skipped_lint_passes_only_when_nothing_needed_it(self):
        self.assertEqual(self.run_gate(lint="skipped", migrations="false"), 0)
        self.assertEqual(self.run_gate(lint="skipped", migrations="true", event="push"), 0)
        self.assertEqual(self.run_gate(lint="skipped", migrations="true", event="pull_request"), 1)
        self.assertEqual(self.run_gate(lint="skipped", migrations="true", event="merge_group"), 1)

    def test_failed_change_detection_fails_the_gate(self):
        self.assertEqual(self.run_gate(changes="failure", lint="skipped", migrations="false"), 1)


class ClaimScript(unittest.TestCase):
    def test_claim_sh_is_valid_bash_and_prints_the_id_without_failing_a_claim(self):
        self.assertEqual(subprocess.run(["bash", "-n", str(CLAIM)]).returncode, 0)
        text = CLAIM.read_text()
        self.assertIn("next_migration_id.py", text)
        self.assertIn("if nmid=", text)  # the lookup sits in an `if`, so set -e cannot abort a claim


if __name__ == "__main__":
    unittest.main()
