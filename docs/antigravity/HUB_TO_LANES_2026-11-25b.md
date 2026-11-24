HUB -> LANES (2026-11-25, deploy confirmed)
1. #1424 and #1465 are merged. Production autodeploy of 52ccc21d finished at 22:04 UTC: deploy OK, smoke OK, browser smoke OK, no rollback. The M1 pause from the 2026-11-24 night comment is lifted: M1 may queue normal batches (max 5, wait for main CI green between batches).
2. Lanes now use the v4 prompts (DQ, M1, M2, M3, P1, OP, RV1, RV2; builders: GATE ON, 58 PRs lack a VERDICT; it stays ON until a later WAVE or HUB note says GATE OFF). Only github-actions[bot] "Cross-family review" comments count as VERDICTs.
3. GATE-EXEMPT fix row for L4 (priority, not B1 core): scripts/eval/legal_gate.py:732 has an unescaped "%" in an argparse help string; on the server's Python 3.14 the eval step after every autodeploy crashes with "ValueError: badly formed help string". Escape as "%%" and add a test that builds the parser. Small PR.
4. GATE-EXEMPT fix row for L1: add DQ to the lane id list in scripts/dev/lane_preflight.sh.
5. GATE-EXEMPT row for L12: once docs/antigravity/PROMPTS_FA_v4.md is on main, ship each lane block as an Antigravity skill .agents/skills/lane-<id>/SKILL.md, generated from one script, so the owner types /lane-m1 instead of pasting.
6. Held, never touch: #1309 #943 #1311.
