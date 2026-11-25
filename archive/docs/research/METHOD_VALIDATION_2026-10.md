# Is our method the best one? Validation and pre-mortem (2026-10-02)

Question from the owner: before every next step, research it, avoid repeating problems, and be sure our approach is the best. This page records what was checked (web search plus the problems we actually hit on 2026-10-01/02), the verdict per decision, and the new guards that follow. Source quality: GitHub docs and GitHub Security Lab are primary; the rest are blogs (UNVERIFIED).

## 1. Problems we actually hit, and their root causes

| Problem | Root cause | Prevented next time by |
| --- | --- | --- |
| Merges were manual | `gh pr merge --auto` only works while the PR cannot be merged yet; our wrapper was defined after its first use; clean/unstable PRs are refused; Mac to GitHub is flaky | Server-side merge gate (issues #351, #354) |
| `Agent review` red on every PR | New job had no checkout, so `gh` had no repo context | Fixed (#350); workflow lint guard (section 4, item C) |
| Worker invented a Docker image and a Trivy version | LLM hallucinates names and versions | Pin verifier (item B) |
| Worker tests failed in CI (float, import of a script as a module, zsh) | Workers cannot run tests | Test feedback round in rx (item A) |
| Over-broad sensitive-path match in the gate | Substring instead of prefix matching | Unit tests now cover it (#352) |
| Codex quota exhausted, OpenRouter blocked from the Mac | Single-lane dependency | Lane policy in `AGENT_LANES_CAPACITY_2026-10.md`; several pool models |

## 2. Decision-by-decision verdict

**Merging.** Options: (a) GitHub native auto-merge at PR creation; (b) merge queue; (c) third-party merge bots (Mergify, Kodiak, bors); (d) our own server-side gate with a token that triggers workflows.
- GitHub docs: auto-merge is offered only on PRs that cannot be merged immediately; permission loss or new pushes disable it.
- Merge queue is not available for private repositories on the Team plan (Enterprise only).
- Merges done with `GITHUB_TOKEN` do not trigger other workflows, so CI on main and auto-deploy would not run; GitHub documents using an App installation token or a PAT instead. Community practice prefers a GitHub App (not tied to a person, can be a ruleset bypass actor); a fine-grained PAT is acceptable but expires and acts as its owner.
- Third-party bots work on private repos but hold write access to the repository outside our control. We rejected similar custody before (OmniRoute, treg).
- Verdict: keep (a) as the fast path and (d) as the authority. Improve (d): migrate the PAT to a GitHub App when convenient (owner action), set a PAT-expiry reminder, require `--match-head-commit`, and make the gate the only checker because admin bypass lets a bad merge skip the ruleset.

**`pull_request_target`.** GitHub Security Lab and GitHub docs: the danger is checking out and executing PR head code with secrets; safe use only inspects PR code as data. Our `Agent review` job checks out the default branch and reads the diff through the API as inert text: compliant. Rules to keep: never check out the PR head in a workflow that has secrets; PR titles, branch names and comment text only through `env:`; minimal `permissions`.

**Cheap-model workers.** Evidence: the scaffold (retrieval, edit-verify loop, feedback format) matters as much as the model; execution feedback is the biggest lever; most tasks that agents solve reliably are small. Our setup (small issues with spec inline, ruff gate with one repair round, follow-up corrections on the same branch) matches this. The missing piece is execution feedback: workers cannot run tests, so failures only surface in CI. Verdict: add a test round to rx (item A).

**Hallucinated names and versions ("slopsquatting").** Research: models invent package names; mitigations are allowlists, verification of every new dependency, and sandboxed dry runs. We saw the same with an image and a tool version. Verdict: automatic existence check of every new image, action, release URL, npm and PyPI pin (item B).

**Overall method.** Deterministic gates around cheap agents, with a human only at approval, is consistent with the current state of the art; we do not rely on an LLM judge for acceptance. Known weaknesses stay: dependence on free-tier providers, one flaky network path from the Mac, and a first real end-to-end Factory run still not done.

## 3. Pre-mortem for the next steps

| Next step | How it could fail | Guard |
| --- | --- | --- |
| `rx-automerge.yml` goes live | Gate bug merges a bad PR (admin PAT bypasses the ruleset) | Explicit required-check list, size cap, sensitive-path rule, `--match-head-commit`, `hold` label, `AUTO_MERGE_ENABLED` switch; first live test on a harmless docs PR |
| PAT expires or is revoked | Merges silently stop | Gate posts a clear comment when the token is missing or rejected; add expiry date to the ops doc |
| Gate workflow changes | `workflow_run` workflows run from the default branch, so edits only take effect after merge | Treat the gate workflow and `merge_gate.py` as sensitive paths (already) |
| Pages deploy | Microsite is public even though the repo is private | Owner enables Pages deliberately; doc states it |
| Factory first run | Unknown unknowns in plan/build | Run on the small brief #236 first; `/report` and ledger give evidence |
| New worker-written workflows | Missing repo context, script injection, over-broad permissions | Workflow lint guard (item C) |

## 4. New guards (issues)

- A. rx runs the new or changed test files itself after the worker finishes (only those files, never over `src/`), and feeds the output back for one repair round.
- B. `scripts/ci/verify_pins.py`: extracts new image tags, GitHub Action versions, release URLs, npm and PyPI versions from a diff and checks they exist; report-only in CI at first, then a blocking rule in the merge gate.
- C. `scripts/ci/check_workflow_safety.py`: fails on `pull_request_target` with a checkout of the PR head, workflows without a `permissions:` block, untrusted `${{ github.event.* }}` fields spliced into `run:`, and `gh` calls in jobs without a checkout and without `GH_REPO`.
