# R22 digest: unattended agent CLIs on subscription logins (2026-11-21)

Source: owner-run deep research, stage 1 only (stage 2 skeptical review NOT yet received). Every price,
limit and date below is "requires primary check" before it drives spend. Facts and decisions are kept apart.

## Reported facts (unverified until stage 2)
- Anthropic consumer terms ban bot/script access except via API key or where explicitly permitted.
  Claude Code docs say subscription limits "assume ordinary, individual usage". A Help Center note
  (reported 2026-10-07) says `claude -p` and the Agent SDK still draw from subscription limits.
  Sharing one personal login across several lanes or shared CI is outside "ordinary individual use".
  EEA consumer terms are reported to say "non-commercial use only" (community reading, unverified).
- Google: consumer sign-in for Gemini CLI ended 2026-06-18. Antigravity `agy -p` is documented for
  scripting, but wrapping it inside other agents is reported as unsupported on consumer plans, with
  403 TOS_VIOLATION waves (latest reported 2026-11-16). A suspension reportedly covers Antigravity,
  Gemini CLI and Code Assist together; one appeal, then a permanent ban.
- OpenAI: `codex exec` with an API key is the documented unattended path. Pooling or rotating
  accounts is forbidden.
- Running one personal login on two of your own machines is allowed; sharing it with another person
  or using two personal accounts to multiply quota is not. Proxied or shifting egress raises ban risk
  for subscription logins, but not for API keys.
- Reported cheap compliant options for 7 lanes at about USD 10-30 per month: (1) direct paid API keys
  with tiered routing, (2) OpenCode Go (USD 10) plus overflow, (3) local models plus a small API budget.

## Proposed decisions
1. Mac lanes L1-L4 stay interactive Antigravity chats pasted by the owner. That is ordinary individual
   use. Never automate them (already a standing rule).
2. Unattended lanes (L5-L7 and the #965 bridge) must not depend on a consumer login. Target: scoped
   API keys under one billing organisation, per-lane keys, hard spend caps.
3. The current bridge runs `claude -p` on the laptop under a personal login. Keep it only for the
   hub-to-hub bridge at low volume until the owner decides on an API key.
4. Gemini CLI needs an API key (consumer login is gone). A USD 5 prepay on Gemini API Paid Tier 1 is
   the cheapest reliable Google option and also gives paid-tier data terms.
5. Operating rules for every unattended lane: keys injected by systemd EnvironmentFile outside the
   repo, staggered schedules off the top of the hour, turn and time caps, stable prompt prefixes.

## Owner decisions (not taken by the hub)
- Spend: API key for the bridge and lanes (about USD 10-30 per month), or OpenCode Go (USD 10).
- Whether the box hub's personal Claude login may keep driving the bridge.

## Not verified
All prices, limits and policy quotes. Stage 2 is missing: ask the owner to send it.
