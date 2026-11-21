---
name: feedback-test-before-telling
description: "Owner requires every link, file, command and tool to be tested before it is presented; lawyer gets only hard questions"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 35c6613c-d845-4f9a-881a-c265fcd2b819
  modified: 2026-09-30T12:44:15.428Z
---

1. Test before telling: open the file path, run the command, load the page. Never hand over a file link that only exists in a worktree or an unmerged PR; link it only after it exists in the main checkout.
2. Questions for the lawyer must be only hard or genuinely ambiguous ones. Anything answerable by searching (which article sets a threshold, whether a text is a law or a bill, where unification rulings are published) must be researched first across several sites, never a single one.
3. The owner states unification rulings (آرای وحدت رویه) are all available on ekhtebar.ir.

**Why:** 2026-09-30 a link to docs/LAWYER_QUESTIONS_ROUND2_FA.md was given before its PR merged ("Couldn't find this file"), OmniRoute was handed over without walking its onboarding, and the round-2 lawyer list contained searchable questions. The owner was angry.

**How to apply:** before the final message, re-check each referenced path with ls in the main checkout and each URL/tool with a real call; say explicitly what was not tested. See [[feedback-research-and-automerge]].
