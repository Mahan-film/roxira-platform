# R21 Part A: Agent bridge between the Mac hub and the box hub

Date: 2026-11-20. Refs #965. Research only, nothing installed.

Goal: replace the owner-as-messenger loop between the Mac hub and the box hub with a direct bridge that keeps an audit trail on #965. The box is behind NAT, egress-locked, and reaches the internet only through a local HTTP proxy. The two hubs use two different Claude accounts.

## 1. Verdict on the two-account question

**Cross-session messaging and Remote Control are same-account features. No documented path crosses accounts.**

- The cross-session page scopes every target to "your" sessions: "your other local sessions", "your Remote Control sessions on other machines", "your cloud sessions". A session on another machine appears only when it runs with Remote Control and the sender is connected too (https://code.claude.com/docs/en/cross-session-messaging.md).
- Remote Control setup says to use "the same account and organization you use for Claude Code in the terminal" (https://code.claude.com/docs/en/remote-control.md).
- The docs never say "a different account fails". That part is an inference from the "your sessions" wording, not an explicit statement.

Consequence: a Remote Control pilot needs both machines logged into the same claude.ai account. With two accounts, the bridge must be GitHub-based.

## 2. Verified facts: Claude Code Remote Control and messaging

| Item | Finding | Min version |
|---|---|---|
| Server mode | `claude remote-control`; flags `--name`, `--spawn same-dir\|worktree\|session`, `--capacity N` (default 32), `--permission-mode`, `--settings <file>`, `-c/--continue`, `--session-id` | server mode v2.1.64 (changelog, per a third-party issue report); newer flags need newer builds |
| Auth | claude.ai login only. API keys, Bedrock/Vertex/Foundry and a non-default `ANTHROPIC_BASE_URL` are NOT supported | n/a |
| Network | Outbound HTTPS only, no inbound ports, port 443 to the Anthropic API | n/a |
| Proxy | Claude Code honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, no SOCKS (https://code.claude.com/docs/en/network-config.md). The Remote Control page names no proxy exception and lists a blocking proxy as a failure cause. Whether Remote Control's streaming connection works through the box proxy is **UNVERIFIED**: test it | n/a |
| Messaging | `ListAgents`, `SendMessage`, `/list-agents` (alias `/peers`) exist | v2.1.224 (macOS/Linux); cross-machine v2.1.225 |
| Inbound | `crossSessionInbound` = `accept` / `hold` / `refuse` | n/a |
| Outbound gate | `isolatePeerMachines: true` forces approval for cross-machine sends; `dialogExpiry` (default 5 min) drops unanswered held messages | n/a |
| Replies | A reply address exists only if the sender is connected to Remote Control. Cloud sessions cannot answer | n/a |
| `-p` workers | Bind an inbox socket (except `--bare`). Unattended receivers must set `crossSessionInbound: accept` via `--settings` | n/a |

The box runs 2.1.329, which meets every minimum above.  Messages are plain text, and a peer message "can't approve anything".

## 3. Verified facts: headless

Claude Code (https://code.claude.com/docs/en/headless.md):

- `claude -p "<prompt>" --output-format json|stream-json|text --allowedTools "..." --permission-mode ... --json-schema ... --append-system-prompt ... --bare`. 
- `--bare` is recommended for scripts and uses `ANTHROPIC_API_KEY` only, never the subscription login, so it does not fit a subscription-logged box.
- `--max-turns` is **not listed** on the headless page I fetched. It existed in earlier versions. Run `claude --help` on the box to confirm. Use `--max-budget-usd` and a systemd `TimeoutStartSec` as hard caps either way.
- Since v2.1.302, `-p` starts in Manual mode unless a mode is set, so an unlisted tool call is denied. `--permission-prompts none` needs v2.1.259+. Use `dontAsk` plus a narrow `--allowedTools`.

Antigravity CLI (https://antigravity.google/docs/cli/headless.md):

- `agy -p`, `--output-format text|json|stream-json`, `--input-format`, `--json-schema`, `--mode`, `--print-timeout`, `--dangerously-skip-permissions`, and `permissions.allow` in settings. **No max-turns flag is documented.**
- Auth: headless "uses your cached credentials"; no API-key route or proxy variable is documented (proxy support **UNVERIFIED**). An open issue reports `-p` dropping stdout on a non-TTY, so test before relying on it (https://github.com/google-antigravity/antigravity-cli/issues/76).
- `agy acp` exists: an ACP server over stdio, protocol v1 (https://antigravity.google/docs/cli/acp.md).

Google account risk:

- **Verified (primary):** Gemini CLI stopped serving individual AI Pro, AI Ultra and free accounts on 2026-06-18, announced 2026-05-19. Paid API keys and Code Assist Standard/Enterprise are unaffected (https://github.com/google-gemini/gemini-cli/discussions/27274). Commenters report it still works for some accounts, which matches the 2026-11-19 sign-in that worked on the box. 
- **UNVERIFIED:** the report that Google suspended AI Pro/Ultra accounts for automating `agy` from other agents (Nov 2026). The report I read cites no Google terms clause or statement (https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-09-03-google-suspends-paying-antigravity-subscribers-for-using-thi/). A Google developer-forum reply said wrapping `agy` with a personal consumer login in a third-party app is not permitted. That is a forum reply, not policy.
- **Recommendation:** any unattended Google lane uses an API key (Gemini API / Agent Platform), never a consumer login.

## 4. Message contract

All messages are GitHub issue comments on #965. The first line is a fixed tag, followed by a JSON object. Other text is ignored.

```
WAVE: <short title>
{"id":"w-0042","lane":"box-ci","task":"Run local CI on branch X and report","acceptance":["exit 0","last 20 log lines"],"max_turns":15,"author":"mac-hub"}
```

- `id`: unique per message (`w-` Mac to box, `b-` box notice, `r-` report). A REPORT repeats the WAVE id as `reply_to`.
- `lane`: a name from a fixed allowlist in the script, never a free path.
- `task`: at most 2000 characters, plain text. `acceptance`: checkable conditions.
- `max_turns`: integer 1 to 30, clamped by the script.
- `author`: informational only. Trust comes from the comment's numeric GitHub user id, not this field.

Who posts what:

- **Mac hub:** `WAVE:` (the task).
- **Box hub:** `BOX:` for status or blockers, and `REPORT:` with `reply_to`, `status` (`done`/`failed`/`blocked`), `summary`, `artifacts` (PR URLs only), `turns_used`.
- **Never in a comment:** secrets, IPs, hostnames, `.env` content (public repo).

## 5. Fallback design: GitHub-polling timer on the box

Works across accounts and keeps the audit trail. Latency is about 2 minutes.

Per tick:

1. Exit if the kill-switch file exists.
2. `gh api` lists #965 comments with an id above the state file's last-processed id.
3. Keep a comment only if its numeric `user.id` is in the allowlist (the owner's accounts) AND the body starts with `WAVE:`. Never match on login names.
4. Parse the JSON, validate the lane, clamp `max_turns`, run `claude -p`, post `REPORT:`.
5. Write the comment id to the state file before running, so a crash cannot loop. A failed run posts `REPORT: failed`.

Prompt-injection notes:

- Only allowlisted numeric ids are processed. Require `updated_at == created_at` so an edited comment is not trusted.
- Strip HTML comments and zero-width characters before parsing.
- Treat `task` as untrusted data inside a fixed system prompt. It must not set paths, flags, or commands.
- Narrow tools (for example `Read,Bash(git status *),Bash(gh pr create *)`), `--permission-mode dontAsk`, a dedicated worktree, no production credentials in the unit environment.

Sketch, not tested:

```ini
# ~/.config/systemd/user/hub-poll.service
[Service]
Type=oneshot
EnvironmentFile=%h/.config/hub-poll.env   # proxy vars, ALLOW_IDS, TOOLS
ExecStart=%h/bin/hub-poll.sh
TimeoutStartSec=900
# ~/.config/systemd/user/hub-poll.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
```

```bash
#!/usr/bin/env bash
set -euo pipefail
S=$HOME/.local/state/hub-poll; mkdir -p "$S"
[ -e "$S/STOP" ] && exit 0
last=$(cat "$S/last_id" 2>/dev/null || echo 0)
gh api "repos/Mahan-film/roxira-platform/issues/965/comments?per_page=100" --paginate \
 | jq -c --argjson last "$last" --argjson ok "$ALLOW_IDS" \
   '.[]|select(.id>$last and (.user.id as $u|$ok|index($u)) and (.body|startswith("WAVE:")) and .created_at==.updated_at)' \
 | while read -r c; do
    id=$(jq .id <<<"$c"); echo "$id" > "$S/last_id"
    body=$(jq -r .body <<<"$c" | sed 's/<!--.*-->//g')
    out=$(timeout 840 claude -p "$(build_prompt "$body")" --output-format json \
      --allowedTools "$TOOLS" --permission-mode dontAsk --max-budget-usd 2 || true)
    gh api repos/Mahan-film/roxira-platform/issues/965/comments -f body="$(make_report "$id" "$out")"
 done
```

`build_prompt` and `make_report` are helpers still to write. Kill switch: `touch $S/STOP`. The `gh` token on the box should be fine-grained, limited to this repo, with issues read/write only.

## 6. Assessments (no install)

- **Goose** (Rust, Apache 2.0, hosted by the Linux Foundation's Agentic AI Foundation since Dec 2025): recipes, scheduled recipes (groundwork in recent releases, syntax not checked), ACP server, and it can use Claude Code or Codex as an ACP provider (https://aaif.io/blog/goose-doubles-down-on-open-in-latest-two-releases). It duplicates `claude -p` plus a timer and adds a provider layer to secure. Defer.
- **Tailscale:** the Personal plan is non-commercial only (https://tailscale.com/pricing/faq), so business use needs a paid plan. **Headscale** is self-hosted and needs a reachable server. **NetBird:** the free plan is "up to 5 users and 100 machines" (https://docs.netbird.io/how-to/plans-and-billing). That page does not say whether commercial use is allowed (**UNVERIFIED**; check its terms). None of the three documents running through an outbound HTTP-only proxy. NetBird has a WebSocket relay route, but I found no confirmation that it works through a forward proxy. A mesh adds little: the bridge needs no inbound path to the box.

## 7. Recommendation

1. **Build the GitHub-polling timer first.** It crosses accounts, fits the egress lock (only the proxy and GitHub), and records every instruction and result on #965. Start with a dry-run mode that skips running Claude.
2. **Remote Control pilot only if both machines can use the same claude.ai account.** First test that its streaming connection works through the box proxy. Set `crossSessionInbound: accept` on the box and `isolatePeerMachines: true` on the Mac. Keep the GitHub comment as the audit record either way.
3. **Google lane:** API key only, no consumer login, until a primary source clarifies the terms.
4. Open items to settle on the box: whether `claude -p --max-turns` is still accepted, and whether `agy -p` returns output without a TTY.
