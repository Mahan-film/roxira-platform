# The hub is a role

The hub is a role, not a product. Claude Code is optional.
Any strong model may act as hub: Claude Code, Antigravity (Gemini), or OpenCode with a strong model.
The owner starts the hub session and stays in it. One acting hub session at a time.

## Who may run it

| Tool | How | Notes |
| --- | --- | --- |
| Claude Code | a chat on the Mac, started from `docs/hub/HUB_START.md` | the old default; not required |
| Antigravity (Gemini) | lane `H1`, prompt `docs/antigravity/prompts/H1.txt` (same block in `PROMPTS_FA.md`) | H1 never merges (see below) |
| OpenCode | an interactive session with a strong model from `config/models.yaml` | same rules as H1 |

Rule for every tool: the reviewer of a PR must be a different model family from its author.
The review desk enforces this: `scripts/dev/review_desk.py` skips reviewers from the author's family, and `scripts/dev/check_reviewer_family.py` checks the model config.
So a Gemini hub's own review never counts as the verdict for a Gemini-authored PR.

## What already runs without a hub

- **Review desk:** a cross-family review of open PRs. It posts `Cross-family review ... @ <sha>` with `Verdict: no blocker` or `Verdict: blocker`.
- **Merge gate:** on the CI box (`docs/ops/MERGE_GATE_SPEC.md`). It merges a PR labelled `merge-queue` when the desk says no blocker at the current head,
  required checks are green, there is no conflict and no hold (`needs-human`, `do-not-merge`).
- **Protected paths** (migrations, payment, billing, auth, `Dockerfile.prod`, production compose, deploy scripts, workflows):
  the gate merges only after the marker line `OWNER-OK #<PR> <sha7>`, posted by the owner approver account. A push voids it.
- **B1 core** (Smart Judge core prompts and algorithms, billing, pricing, tax rules, all `country_packs/**`) is labelled `needs-human`.
  The gate never merges it. It needs a hub review in an owner-driven session, or the owner's `OWNER-OK`.

## One hub round

1. Sync: `git fetch origin main`, then read `git show origin/main:docs/STATE.md` and `docs/agents/LESSONS.md`.
2. Read the newest comments on issue 592: lane `REPORT`s, `BLOCKED` lines, `BOX:` notes. Read `ASK-HUB:` on #965.
3. Triage new issues: add `lane:L<n>`, `prio:1|2|3`, and `needs-human` for B1 core or protected paths. Close duplicates with a link.
4. Plan the next wave: `python3 scripts/dev/wave_gen.py --dry-run`. Show the draft to the owner.
   Post the `## WAVE` comment on #592 only after the owner says so in the current chat.
5. Read desk verdicts on open PRs. Send real blockers back to the lane with a `HUB -> LANES` note on #592.
6. Review B1 PRs labelled `needs-human` line by line. Post the result as a PR comment. Never edit B1 code from a lane.
7. For protected PRs, prepare an Owner packet: `bash scripts/dev/owner_ok.sh <PR>`.
   It prints the packet and the exact `OWNER-OK #<PR> <sha7>` line. The owner posts that line from the approver account.
8. Update `docs/STATE.md` and add new review lessons to `docs/agents/LESSONS.md`, both through a small PR.

`scripts/dev/wave_gen.py` and `scripts/dev/owner_ok.sh` land with a separate scripts PR. Until they are on `main`, do steps 4 and 7 by hand.

## Hard rules for every hub tool

- A production write (merge to `main`, server change) needs the owner's sentence in the current chat. An earlier session's "yes" does not count.
- Check CI at job level and read every PR comment newer than the head before you call a PR ready (lessons 30, 37).
- Never print secrets. Never name a country: say "default pack".
- No unattended automation for interactive accounts (no `/schedule`, no `/teamwork`).
