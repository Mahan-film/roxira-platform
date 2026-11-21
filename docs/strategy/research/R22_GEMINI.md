# R22 Gemini Deep Research (second opinion)

The owner pasted this Gemini Deep Research output earlier. It is saved unchanged except: the model's internal "Thoughts" blocks are left out (none were in this paste), citation span markers are removed (none were present), the owner's short lead-in sentence before the report is dropped, and no country name needed replacing. Stage 2 was not received: only the Stage 1 report and its source list were found in the owner's old messages (the Stage 2 review pasted nearby belongs to a different research item). Prices, limits and dates below are Gemini's claims and are UNVERIFIED unless the digest says otherwise.

## Stage 1

Unattended Agent CLIs on Consumer Subscriptions: 2026 Terms, Limits, Enforcement, and Compliant Architecture

As of November 2026, running unattended, cron-scheduled, or multi-lane coding agents on personal consumer subscription OAuth logins is legally narrow, operationally brittle, and actively policed across Anthropic, Google, and OpenAI. Although all three vendors document non-interactive CLI flags (claude -p, agy -p, codex exec) and narrow single-user automation paths, all three separate ordinary individual use inside first-party binaries from automated backend pipelines, third-party agent harnesses, and multi-account quota pooling. Throughout 2026, Anthropic and Google deployed server-side OAuth blocks, header fingerprinting, and automated prompt classifiers that suspended violating accounts—with Google enforcing a strict two-strike permanent ban across Antigravity, Gemini CLI, and Gemini Code Assist simultaneously.

For an architecture running 7 unattended agent lanes within a USD 5–30/month budget, consumer subscriptions fail on both compliance and reliability because of rolling 5-hour session caps, silent OAuth token expirations, and VPN/proxy abuse triggers. Because 2026 compact coding models have dropped to $0.10 input / $0.50 output per million tokens with $0.01 cache reads (Claude Haiku 5.5 and GPT-6 Luna) and OpenCode Go offers a $10/month API-key subscription across open-weight coding models, you can run all 7 lanes compliantly on Commercial/Platform API terms for $5–$30/month with zero ban risk, hard spend caps, and default non-training data terms.

1. Claude Code on Personal Pro, Max, and Ultra Logins

Legal Status and Verbatim Policy Clauses

Anthropic splits Claude Code into two distinct legal regimes: Consumer Terms of Service govern Free, Pro ($20/month, or $17/month billed annually at $200 upfront), Max ($100/month), and Ultra ($200/month) plans, while Commercial Terms of Service govern Team, Enterprise, and Claude API (Console) users. Earlier in 2026, Anthropic marketed its $100 and $200 tiers as Max 5x and Max 20x; official documentation as of October–November 2026 standardizes the consumer lineup as Pro, Max, and Ultra.

Three governing clauses define what is permitted on a consumer login. First, Anthropic's Consumer Terms of Service (Effective October 8, 2025), Section 3 (Item 7 / Section 3.7) prohibits automated access unless exempted:

> “Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.”

> Second, the official Claude Code Legal and Compliance page (code.claude.com/docs/en/legal-and-compliance) narrows subscription expectations under Acceptable Use:

> “Claude Code usage is subject to the Anthropic Usage Policy. Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK.”

Third, the Authentication and Credential Use section of the same compliance page—introduced on February 19, 2026, following the January third-party OAuth crackdown—restricts where OAuth credentials may run:

> “OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications... Developers building products or services that interact with Claude’s capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic’s own flow.”

> Two regional and data-governance caveats further separate consumer logins from Commercial API use. Community reviews of Anthropic's EEA Consumer Terms (October 8, 2025) cite an explicit "Non-commercial use only. You agree that you will not use our Services for any commercial or business purposes" clause that does not appear in the US Consumer Terms—making Commercial API keys or Team seats the only unambiguous choice for business automation in Europe. Additionally, Anthropic's revised Usage Policy took effect on November 12, 2026, and Consumer plans retain interaction data for up to 5 years when model improvement is left enabled (30 days if opted out), whereas Commercial and API plans enforce 30-day standard retention and never train on customer content.

Is claude -p, Systemd/Cron, or CI Allowed on Pro, Max, or Ultra?

Whether headless execution is allowed on a personal subscription hinges on first-party invocation and individual scale. Following developer pushback over a planned June billing change, Anthropic paused its move to strip programmatic access from consumer plans on June 15, 2026. An official Help Center update on October 7, 2026 (support.claude.com/en/articles/15036540) confirmed that when authenticated with a Claude subscription, both claude -p and the Claude Agent SDK continue to draw from your subscription limits. Anthropic explicitly documents claude -p headless execution, Desktop local scheduled tasks, Cloud Scheduled Tasks (formerly Routines, which reject cron intervals more frequent than once per hour), session-scoped /loop / CronCreate tasks, and the Claude Code GitHub Action authenticated via CLAUDE_CODE_OAUTH_TOKEN (generated via claude setup-token) across Pro, Max, and Ultra plans.

That allowance stops well short of multi-lane background infrastructure or shared CI. Anthropic's GitHub Actions documentation warns that CLAUDE_CODE_OAUTH_TOKEN is tied to an individual's personal subscription and is not recommended for organization-wide or shared repository secrets. Running 7 continuous unattended systemd/cron lanes on a single consumer login strains "ordinary, individual usage" and runs into built-in technical blockers: OAuth sessions expire on fixed windows (claude auth status --text reports Sign-in ends, claude -p prints stderr warnings within 10 days of expiry, and background sessions disconnect once expired), and a security review of Claude Code v2.1.302+ notes that claude -p defaults to default (Manual) permission mode where unapproved tool calls are automatically denied unless explicitly permitted via --permission-mode dontAsk --allowedTools or hooks. Extracting or replaying consumer OAuth tokens inside any third-party client (OpenCode, OpenClaw, Cline, RooCode, Hermes) or local reverse proxy has been prohibited and server-side blocked since January–April 2026.

Rate Windows, Concurrency, and Account Flag Triggers

Consumer subscriptions enforce two layered usage ceilings shared across claude.ai web, desktop, mobile, IDE extensions, Claude Code CLI, and Cloud Scheduled Tasks. Pro ($20) and Max ($100) have both a rolling 5-hour session limit (anchored to your account's activity rather than clock hours) and a 7-day weekly limit across all models; verified Ultra ($200) accounts have no 5-hour session limit, facing only weekly limits. Max and Ultra also enforce a separate weekly cap for Claude Fable models. Per third-party tracking of Anthropic's official pricing page as of October–November 2026, Max provides 5x Pro's usage every 5 hours and weekly, while Ultra provides 10x Pro's weekly usage. Anthropic publishes neither fixed token baselines nor a numeric consumer concurrency cap—remaining capacity appears only as percentages in Settings > Usage or statusline JSON fields (rate_limits.five_hour.used_percentage, rate_limits.seven_day.used_percentage). A capped "wrap-up allowance" lets an active step finish if a 5-hour cap hits mid-turn (up to once weekly on Pro, and per 5-hour window on Max), and subscribers may enable optional usage credits with a monthly spend limit to continue past plan caps.

Console API keys bypass session and weekly windows completely and are metered by Requests Per Minute (RPM), Input Tokens Per Minute (ITPM), and Output Tokens Per Minute (OTPM) across three usage tiers (Start, Build, Scale, plus Custom). Official Claude Code capacity planning docs recommend 200k–300k TPM and 5–7 RPM per active developer for 1–5 concurrent users.

Based on Anthropic's compliance docs, Help Center guidance, and 2026 enforcement waves, account flags and suspensions are triggered by five behaviors: routing consumer OAuth tokens through third-party wrappers, modified binaries, or local reverse proxies such as CLIProxyAPI (caught via server-side header fingerprinting); creating or rotating multiple accounts to evade limits or prior bans; sharing credentials or making a consumer account available to other people; operating from unsupported regions or flagged VPN nodes; and repeated Usage Policy violations. Suspensions typically arrive as generic "suspicious signals" emails with no subscription refund under Consumer Terms.

Officially Supported Unattended Paths and November 2026 Costs

Anthropic's officially supported Commercial-Terms unattended paths are: (1) ANTHROPIC_API_KEY with claude -p (in Claude Code's authentication precedence, cloud provider variables rank #1, ANTHROPIC_AUTH_TOKEN #2, and ANTHROPIC_API_KEY #3, automatically overriding subscription /login at #7); (2) the Claude Agent SDK (Python/TypeScript, governed by Commercial Terms); (3) Claude Managed Agents via the Claude API; and (4) the Claude Code GitHub Action using ANTHROPIC_API_KEY, cloud credentials (Bedrock, Google Cloud Agent Platform/Vertex, Microsoft Foundry), or keyless GitHub OIDC Workload Identity Federation.

Since October 7, 2026, Max ($100/mo) includes $100/month in Console API credits and Ultra ($200/mo) includes $200/month (eligible after a 7-day wait period, non-rollover, linked to one Console organization). These credits pay for the Claude API, Managed Agents, Agent SDK, and self-executed claude -p commands authenticated with an API key from the linked Console org—but explicitly exclude claude -p runs launched by the Claude Code GitHub Action, IDE extensions, Claude desktop, or interactive CLI sessions, and Pro ($20/mo) receives $0 in API credits.

Claude Model (Official API Pricing, Nov 2026)	Standard Input / 1M	Standard Output / 1M	5m Cache Write / 1M	Cache Read / 1M (Multiplier)	Batch Input / Output / 1M
Claude Haiku 5.5 (prompts ≤100k tokens)	$0.10	$0.50	$0.125	$0.01 (0.10x)	$0.05 / $0.25
Claude Haiku 5.5 (prompts >100k tokens)	$0.50	$2.50	$0.625	$0.05 (0.10x)	$0.25 / $1.25
Claude Sonnet 5.5	$2.00	$10.00	$2.50	$0.10 (0.05x)	$1.00 / $5.00
Claude Opus 5.5	$4.00	$20.00	$5.00	$0.20 (0.05x)	$2.00 / $10.00
Claude Fable 5.2	$8.00	$40.00	$10.00	$0.20 (0.025x)	$4.00 / $20.00

Source: Anthropic Official Pricing Docs (platform.claude.com/docs/en/about-claude/pricing), November 2026. Anthropic's optimization benchmarks show agentic coding loops read 89%–93% of input tokens from prompt cache.

2. Google Antigravity (agy -p) and Gemini CLI

The June 18, 2026 Gemini CLI Consumer Sign-In Cutoff

Google terminated consumer OAuth access to Gemini CLI in mid-2026. Per Google's official deprecation notice (developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals, updated October 9, 2026):

> “Starting June 18, 2026, Gemini Code Assist IDE extensions stopped serving requests for the Gemini Code Assist for individuals, Google AI Pro, and Google AI Ultra tiers. This also applies to usage of Gemini CLI. As part of the deprecation, you can no longer use the Login with Google option to access the IDE extensions or Gemini CLI.”

Although legacy documentation pages on geminicli.com still list older 1,000–2,000 requests/day "Login with Google" quotas, consumer OAuth on Gemini CLI no longer serves requests. Commercial Gemini Code Assist Standard and Enterprise seats were excluded from the June 18 cutoff but entered their own sunset on October 9, 2026 (no new purchases allowed; final annual renewals end January 31, 2027; Gemini Enterprise entitlements end March 31, 2027; final monthly renewals end December 31, 2027; models capped at Gemini 3.x). Today, Gemini CLI works exclusively with Gemini API keys (Free or Paid Tier) or Vertex AI / Google Cloud billing.

Google Antigravity (agy -p) on Consumer Logins: Policy vs. Enforcement

Google transitioned all individual CLI users to Antigravity CLI (agy), launched May 19, 2026. Antigravity's headless documentation (antigravity.google/docs/cli/headless/) explicitly documents agy -p (--print / --prompt), json and stream-json modes, and CI usage using cached interactive keyring credentials.

In practice, however, consumer Antigravity OAuth carries the highest suspension risk of any major coding CLI in late 2026. Two policy texts govern enforcement. First, the unheaded abuse clause of the Google Antigravity Additional Terms of Service (widely cited as Section/Clause 6) prohibits external tool integration:

> “You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us.”

> Related official enforcement notices and appeal disclosures explicitly specify the prohibited pattern:

> “Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth, Gemini CLI OAuth, etc.) is a violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your account.”

> Second, Google's Antigravity FAQ (revised in autumn 2026) narrows who may invoke agy -p on personal plans:

> “Antigravity CLI headless mode (agy -p) is intended for direct scripting and CI workflows.” — while adding that wrapping agy “inside third-party coding agents or applications … is not supported under consumer plans,” and (per developer reviews of the localized FAQ) likewise barring automated account rotation on personal plans.

> Enforcement has been abrupt and aggressive. Developer reporting (afengblog.com) documents that on October 7, 2026, a Google staff member initially posted on the developer forum that spawning unmodified agy from Claude Code was permitted—only for Google to reverse that stance roughly 26.5 hours later via an FAQ edit without amending the Terms. Subsequent automated HTTP 403 PERMISSION_DENIED (TOS_VIOLATION) enforcement waves—including a November 16, 2026 wave that hit paying Google AI Pro subscribers—locked out users running unmodified agy --print spawned from local orchestrators, Claude Code, Codex, MCP servers, or bursty multi-agent /swarm runs.

Crucially, Google confirmed in an official GitHub announcement (google-gemini/gemini-cli Discussion #20632, February 27, 2026) that abuse prevention runs at a shared backend layer (cloudcode-pa.googleapis.com), meaning an Antigravity suspension simultaneously disables Antigravity, Gemini CLI, and Gemini Code Assist (with some users also reporting wider Google AI Studio restrictions). Every Google account is permitted only a single self-service reinstatement appeal (automated 48–72 hour review after submitting a recertification form, with no confirmation email); a second violation triggers a permanent ban.

Quotas, Concurrency, Free API Key Limits, and Cheapest Compliant Headless Option

On consumer Antigravity plans, Free ($0/mo) provides an unpublished weekly quota with no paid overages and no BYOK in the GUI; effective November 30, 2026, Claude 4.6 and GPT-OSS-120b are removed from the Free tier, leaving Gemini 3.8 Flash alone. Paid Google AI Pro ($20/mo) and Google AI Ultra ($100/mo = 5x Pro; $200/mo = 20x Pro, repriced May 19, 2026) refresh every 5 hours with weekly ceilings, drawing Gemini models from one shared pool weighted by API price while keeping non-Gemini partner models (such as Claude 5.5) on a separate fixed cap. Google publishes no fixed prompt counts or numeric consumer concurrency caps, warning only that limits scale with agent work and that parallel multi-agent setups burn quota far faster. To run agy programmatically without risking a consumer OAuth ban, developer guides citing Google's Antigravity authentication docs confirm you can set "modelProvider": "gemini" in settings.json and pass GEMINI_API_KEY, forcing agy onto standard Gemini API billing.

For Gemini CLI or headless scripts using an unpaid Gemini API key (Google AI Studio Free Tier), Google still offers zero-cost access to Gemini 4 Hydrogen (the only free Gemini 4 model), Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, and Gemma 4—while Gemini 4 Carbon, Neon, and Argon are paid-only. However, the Free Tier is poorly suited to unattended 7-lane workloads for four reasons: limits apply per Google Cloud project (not per API key) and reset at midnight Pacific; Gemini CLI explicitly caps unpaid keys at 250 requests/day (Flash only), while third-party tracking after Google's December 2025 quota cuts places general Flash free-tier ceilings at roughly 5–15 RPM and 100–1,000 RPD with frequent 429 RESOURCE_EXHAUSTED failures on 3.8 Flash; secondary projects often trigger 403 FREE_TIER_VERIFICATION_REQUIRED mobile verification checks; and Google may use Free Tier prompts and outputs to improve its products (model training).

The cheapest reliable, compliant headless Google option is upgrading an AI Studio project to Gemini API Paid Tier 1 by linking a billing account and making a $5 minimum Prepay purchase (upgrade is instant, sets a $250 billing cap and a $10 per 10-minute rolling spend-velocity cap, unlocks Batch/Flex 50% discounts, and switches to paid-tier data terms). Note that since March 2026, Google Cloud's $300 Free Trial credit explicitly excludes Gemini API charges. Running Gemini CLI, OpenCode, or agy ("modelProvider": "gemini") with GEMINI_API_KEY on Paid Tier 1 gives access to Gemini 3.6 Flash at $0.75 input / $3.75 output / $0.075 cache read per 1M tokens through December 31, 2026 (doubling to $1.50 / $7.50 / $0.15 on January 1, 2027; Batch/Flex is 50% off). Official pricing tables also list Gemini 4 Argon at $2.00 / $10.00 through November 30, 2026 (doubling to $4.00 / $20.00 on December 1, 2026) and Gemini 4 Neon at $3.00 / $15.00. Official pricing extracts did not publish rates for Gemini 4 Hydrogen, Gemini 3.8 Flash, or Gemini 3.5 Flash-Lite; a November 19, 2026 third-party tracker (ofox.ai) reading AI Studio reported Gemini 4 Hydrogen at $1.50 input / $7.50 output (with default high-thinking tokens billed as output, making low-thinking configuration essential). For organizations, Google Cloud also offers Antigravity under Gemini Enterprise on a $0/seat pay-as-you-go consumption tier.

3. OpenAI Codex CLI and OpenCode: Subscriptions vs. API Keys

OpenAI Codex CLI (codex exec)

OpenAI offers the most permissive subscription-automation posture of the three frontier labs in 2026, though it still prohibits multi-account pooling, credential sharing, and untrusted CI exposure. OpenAI's Terms of Use state plainly: "You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account," and forbid attempts to "circumvent any rate limits or restrictions or bypass any protective measures". Uniquely, OpenAI's Sign in with ChatGPT (SIWC) Terms (Section 3.1) allow connected third-party apps to run on a user's ChatGPT plan when requests originate from a runtime controlled exclusively by that user and arise from "their activity or expressly authorized automations or background processes" (with express consent required before background runs)—while expressly prohibiting "Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits. Pooling, transferring, reselling, gifting, or sharing ChatGPT plan usage".

For non-interactive execution (codex exec), OpenAI's authentication documentation (developers.openai.com/codex/auth) supports three workflows. First, CODEX_API_KEY is OpenAI's recommended path for CI, scripts, and cron jobs: it authenticates codex exec, code review, the TypeScript SDK, and remote exec-server against OpenAI Platform billing with no 5-hour windows and no model training by default (at the cost of losing ChatGPT cloud features such as GitHub PR review and Slack). Second, headless ChatGPT subscription login is officially documented via codex login --device-auth (Beta), SSH port forwarding (ssh -L 1455:localhost:1455), or copying ~/.codex/auth.json to your own remote server or Docker container—though Plus and Pro train on data unless opted out. Third, Enterprise workspaces can issue CODEX_ACCESS_TOKEN piped to codex login --with-access-token for approved private CI runners and scheduled automations. OpenAI warns never to expose Codex inside untrusted or public CI environments.

Subscription tiers and limits shifted markedly in late 2026. Free ($0) and Go ($8/mo) include desktop Codex (GPT-6 Luna) only and exclude the CLI. Plus ($20/mo) unlocks the CLI, IDE extension, and cloud features under a rolling 5-hour window plus a weekly cap, shared with ChatGPT Work (and consolidating into one combined ChatGPT + Codex meter starting in December 2026). Published 5-hour estimates on Plus span 5–45 GPT-6 Astra, 15–160 GPT-6.1 Sol, or 350–3,000 GPT-6 Luna messages, with Fast mode burning included limits 2.5x faster. Pro ($100, $200, and $500/mo) permanently eliminated the 5-hour window on September 29, 2026, leaving only a weekly allowance—though OpenAI cut the weekly allowance for new Pro $200 subscribers on September 29 (ending grandfathering October 29, 2026), and only Pro $500 unlocks 8x-burn Astra Ultrafast. (Evidence caveat: One third-party blog claims Pro 100/200/500 include matching $100/$200/$500 monthly API credits, whereas two other October–November 2026 technical guides state ChatGPT plans include no API credits and OpenAI's official Codex pricing snippets separate API billing without listing included API credits. Verify in your Platform billing dashboard before budgeting around Pro API credits.) No hard consumer concurrency cap is published, but parallel subagents multiply token drain; OpenAI recommends capping threads in .codex/config.toml via default_subagent_model = "gpt-6-luna" and max_concurrent_threads_per_session = 2. Account flags on OpenAI target credential sharing/reselling, multi-account rotation/pooling to bypass rate limits, automated data extraction, and safeguard circumvention.

On OpenAI Platform API billing (developers.openai.com/api/docs/pricing, November 2026), GPT-6 Luna costs $0.10 input / $0.50 output per 1M tokens (cached input ≤$0.01; Batch/Flex $0.05 / $0.25 / $0.005 cached), GPT-6.1 Sol and GPT-6.2 Sol cost $2.00 input / $10.00 output ($0.10 cached; Batch $1.00 / $5.00), and GPT-6.2 Astra costs $8.00 input / $40.00 output ($0.40 cached; Batch $4.00 / $20.00).

OpenCode: Third-Party OAuth Bans vs. OpenCode Go and Zen

OpenCode (maintained by Anomaly Innovations) bore the brunt of 2026's third-party OAuth restrictions. Anthropic blocked OpenCode's spoofed Claude OAuth headers on January 9, 2026, and forced OpenCode to remove all Claude OAuth support on February 19, 2026 (commit 973715f, with full enforcement on April 4, 2026). Google Antigravity's FAQ explicitly names OpenCode as prohibited third-party software subject to immediate 403 suspension. While OpenAI publicly supported OpenCode's Codex OAuth integration in early 2026 under SIWC, GitHub Issue #27905 on anomalyco/opencode subsequently documented opencode auth login removing ChatGPT Plus/Pro OAuth methods in favor of API keys, making consumer OAuth inside OpenCode unsuitable for unattended production across all three labs.

Instead, OpenCode offers two fully compliant, API-key-authenticated native billing routes: OpenCode Go ($10/month; Go Plus $40/month; Go Teams $20/member/month) and OpenCode Zen (pay-as-you-go prepaid Console balance covering ~85 models including Claude Sonnet/Opus 5.5 and GPT-6.1 Sol at zero token markup plus a 4.6% + $0.31 top-up fee, with zero data retention on paid models). Go authenticates via an API key officially validated for use inside OpenCode, Claude Code, Codex, Pi, and Hermes, with training endpoints blocked by default. Each of Go's ~30 curated models carries a monthly dollar token allowance paced at 20% per rolling 5-hour window and 50% per week: as of November 2026, Go ($10/mo) grants $100/mo ($20/5h) on DeepSeek V4.1 Flash (~43,300 est. requests/5h; note 2x peak-hour pricing and a monthly-renewed ZDR agreement), $60/mo ($12/5h) on GLM-5.3-Flash, Kimi K2.7 Code, MiMo-V2.6-Flash, MiniMax-M3, and Qwen3.7 Plus, $30/mo ($6/5h) on Gemini 4 Argon and Qwen3.8 Flash, $20/mo ($4/5h) on MiniMax M3.1 Flash, and $15/mo ($3/5h) on Claude Haiku 5.5, GPT-6 Luna, Kimi K3.1 Pro, DeepSeek V4 Pro, Qwen3.8 Max, and Grok 4.7. (Operational caveats: Community reports on r/opencode show cross-model switching can still trip a shared weekly cap before every individual model reaches 100%, and OpenCode has revised Go limits repeatedly during 2026. Enabling Extra Usage spills over cleanly to Zen Console credit so unattended lanes avoid HTTP 429 stalls. Do not rely on OpenCode's promotional free models for unattended jobs: they suffer outages, carry unpublished caps, and may train on prompts.)

4. Multi-Machine Accounts, Credential Sharing, and Proxied Networks

One Login on Two Machines vs. Two Accounts (One Per Machine)

Multi-machine compliance depends on human identity and intent. Running one personal subscription login across two of your own machines (for example, your laptop and a personal Linux server) is permitted under the written terms of Anthropic, OpenAI, and Google: every vendor bans sharing credentials "with anyone else" or making an account available "to anyone else", not installing a CLI on multiple personal devices. OpenAI explicitly documents copying ~/.codex/auth.json to your own remote host or container and confirms that a laptop, VPS, and Codex cloud all draw from one personal allowance, while Anthropic and Google both support SSH/remote sessions for individual subscribers. Operationally, however, concurrent automated traffic from two distant IP addresses or frequent login/logout cycling can trip automated bot or account-sharing detectors—especially on Google and Anthropic—while rapidly exhausting shared 5-hour windows.

Sharing a single consumer login with another person (including a teammate or family member) is expressly forbidden across all three providers. Maintaining two separate consumer accounts (one per machine) is compliant only when separating distinct legal identities—such as a personal subscription and an employer-provisioned corporate seat (Anthropic documents CLAUDE_CONFIG_DIR specifically for isolating personal and work configs on one machine). Creating or operating two personal accounts to split lanes, multiply 5-hour quotas, or rotate around rate limits violates all three vendors' rules: Anthropic's Usage Policy prohibits creating multiple accounts to bypass guardrails or evade limits; Google Antigravity's FAQ bans "automating account rotation" on personal plans; and OpenAI's SIWC Section 3.1 explicitly prohibits "Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits". The clean multi-machine pattern is provisioning separate scoped API keys (one per machine or per lane) under a single Commercial/Platform billing organization—a practice Anthropic's Legal & Compliance docs explicitly affirm.

Risks of Running from a Proxied Network

Network proxies create sharply asymmetric risk between consumer OAuth and Commercial API keys. Running consumer OAuth behind VPNs, shared residential/datacenter proxies, or shifting exit nodes carries high suspension risk: Google Antigravity forum moderators explicitly advise keeping VPN and proxy routing turned off even on the official client to avoid triggering a second, permanent 403 suspension, Anthropic users report account lockouts linked to VPN egress and unsupported-region checks, and OpenCode's free tier degrades or triggers quota errors over VPNs and shared networks. Worse, routing subscription OAuth through local translation proxies (CLIProxyAPI, Antigravity reverse proxies, or custom OpenAI-compatible subscription relays) invites near-certain bans: both Anthropic and Google deploy header and prompt fingerprinting, and developers who routed Claude Code through CLIProxyAPI to call GPT models (claudex) suffered Anthropic "suspicious signals" suspensions in August 2026.

By contrast, Commercial API keys behind corporate proxies, LLM gateways, or cloud VPS infrastructure are fully supported. Claude Code natively authenticates against corporate LLM gateways via ANTHROPIC_AUTH_TOKEN, and Codex CLI explicitly documents custom corporate proxy root certificates via CODEX_CA_CERTIFICATE (falling back to SSL_CERT_FILE). The only network constraint on API keys is keeping egress servers in a vendor-supported jurisdiction.

5. Cheapest Fully Compliant Setup for 7 Unattended Lanes (~USD 5–30/Month)

Why Consumer Subscriptions Fail for 7 Unattended Lanes

Although a single $20/month Claude Pro, ChatGPT Plus, or Google AI Pro subscription fits numerically inside a $5–$30/month budget, it is unsuitable for 7 unattended lanes. Seven scheduled workers rapidly drain rolling 5-hour consumer windows—community reports on ChatGPT Plus documented single heavy coding tasks burning double-digit percentages of a 5-hour cap in minutes—while OAuth logins silently expire and stall background daemons, and running continuous multi-lane automation from a VPS or proxy risks ToS enforcement including Google's two-strike permanent ban.

Illustrative Token-Budget Calculation for 7 Unattended Lanes

Actual agent token volume varies sharply by codebase size and loop depth—one 2026 engineering team logged ~330,000 tokens per request on heavy multi-turn runs, whereas disciplined, tightly scoped headless jobs with prompt caching achieve 89%–93% cache-read hit rates. To compare architectures transparently, consider an illustrative moderate workload across 7 lanes: 60 million input tokens/month (90% cached: 6M new/cache-write tokens + 54M cache-read tokens) and 12 million output tokens/month (~2,100 scheduled runs/month, or 10 scoped runs/day per lane).

Applying tiered model routing (85% of token volume on budget models, 15% escalated to mid-tier/frontier models) at November 2026 Anthropic API list rates—including the 1.25x 5-minute cache-write multiplier on all 6M uncached input tokens—yields:

⚬ Routine lanes (85% of volume) on Claude Haiku 5.5 (≤100k) ($0.125/M 5m cache write, $0.01/M cache read, $0.50/M output; identical base rates on GPT-6 Luna): (5.1 × $0.125) + (45.9 × $0.01) + (10.2 × $0.50) = $0.64 + $0.46 + $5.10 = $6.20/month.

⚬ Complex/escalation lanes (15% of volume) on Claude Sonnet 5.5 ($2.50/M 5m cache write, $0.10/M cache read, $10.00/M output; matching base/cache rates on GPT-6.2 Sol): (0.9 × $2.50) + (8.1 × $0.10) + (1.8 × $10.00) = $2.25 + $0.81 + $18.00 = $21.06/month.
* Combined monthly inference total: $27.26/month (dropping to $20.60/month at a 90%/10% budget-to-frontier split, or $11–$18/month if asynchronous lanes use 50%-off Batch processing; add ~$5/month if hosted on an external VPS).

Comparison of 3 Fully Compliant Options (~USD 5–30/Month)

Option & Core Stack	Monthly Cost	Reliability	Ban Risk	Setup Effort
1. Direct Multi-Provider Paid APIs (Tiered Routing)
claude -p / codex exec / OpenCode / Agent SDK using Haiku 5.5 + GPT-6 Luna (5–6 routine lanes) and Sonnet 5.5 / GPT-6.2 Sol (1–2 complex lanes); optional Gemini 3.6 Flash Paid Tier 1	$10–$30/mo
(~$20.60–$27.26/mo on the 72M-token benchmark at 10%–15% frontier; $6–$15/mo on lighter or Batch lanes; +$5/mo if VPS-hosted)	Very High. Commercial Tier 1+ RPM/TPM quotas, zero 5-hour session windows, no OAuth expiration, native 50% Batch discount, proxy/VPS-safe	Zero. Governed by Commercial/Platform API Terms with explicit automation rights and no training by default	Medium. Provision 1–2 Console orgs, set hard spend caps, issue scoped per-lane API keys, configure staggered systemd timers and max-turn limits
2. OpenCode Go ($10/mo) + Zen/API Overflow
Single OpenCode Go API key driving OpenCode, Claude Code, or Codex; lanes distributed across DeepSeek V4.1 Flash ($100 pool), GLM-5.3-Flash / MiMo-V2.6-Flash ($60), Gemini 4 Argon ($30), and Haiku 5.5 / Luna ($15), plus Extra Usage Zen spillover	$10–$26/mo
($10/mo Go base + $0–$15 prepaid Zen spillover, plus 4.6% + $0.31 top-up fee; +$5/mo if VPS-hosted)	Medium–High. High token leverage for $10/mo, but bound by 20% 5-hour / 50% weekly pacing caps, 2x DeepSeek peak rates, and periodic policy adjustments; Extra Usage prevents hard 429 stalls	Zero. Go is explicitly sold as an API-key coding subscription across OpenCode, Claude Code, and Codex; training endpoints blocked by default	Low–Medium. Single OpenCode Console account and key, assign distinct Go models per lane to spread allowances, toggle Extra Usage with a capped Console balance
3. Hybrid Local Ollama + Paid API Escalation
Ollama (localhost:11434, e.g., Qwen2.5-Coder-32B / DeepSeek Coder V2) on existing local hardware (32GB+ RAM, Apple Silicon or RTX 3080+) for 5 routine lanes + Anthropic/OpenAI API keys for 2 frontier lanes	$5–$15/mo
($0 marginal inference on 5 local lanes + $5–$15/mo cloud API spend on 2 escalation lanes; excludes existing hardware and electricity)	Medium–High. Zero cloud rate limits on 5 local lanes, but local GPU queues serialize concurrent jobs, host must remain awake 24/7, and local 32B models trail frontier coding quality	Zero. Local open-weight inference plus Commercial API Terms on escalation lanes; maximum code privacy	High. Configure local GPU/RAM host, run Ollama with a job lock so 5 lanes do not OOM, wire fallback API keys and escalation triggers

Selection Guidance and Operational Guardrails

Choose Option 1 (Direct Tiered APIs) when maximum reliability, clean VPS/corporate-proxy routing, and zero third-party intermediary risk are priorities; starting on a single provider (Haiku 5.5 + Sonnet 5.5, or GPT-6 Luna + GPT-6.2 Sol) keeps prompt caching and spend controls simple before adding a second provider for failover. Choose Option 2 (OpenCode Go + Zen) when your 7 lanes are token-heavy—such as frequent repository audits, log triage, or multi-turn test-fix loops—where spreading lanes across Go's $60–$100 Flash pools multiplies volume per dollar while Extra Usage prevents 429 failures. Choose Option 3 (Local Ollama + Paid API) if you already run an always-on 32GB+ Apple Silicon or RTX 3080+ machine and want both the lowest recurring cloud bill ($5–$15/month) and local-only data residency for routine jobs.

Before enabling systemd timers or cron across all 7 lanes, implement five operational guardrails:

1. Enforce hard provider spend caps and disable unconstrained auto-reload in Anthropic Console, OpenAI Platform, or Google AI Studio—accounting for Google's ~10-minute Prepay billing lag during runaway bursts.

2. Keep paid API keys out of agent-readable workspace .env files: documented 2026 incidents show coding agents reading operational .env keys from the working directory and writing unauthorized metered API runners. Inject keys strictly via systemd EnvironmentFile outside the repo, trim unused MCP servers, and restrict tools with --allowedTools and OS sandboxing.

3. Stagger all 7 schedules off the top of the hour (for example, :03, :11, :19, :27, :35, :43, :51) to prevent overlapping RPM/TPM spikes and avoid top-of-hour queue congestion.

4. Cap turns and shell timeouts on every invocation (BASH_DEFAULT_TIMEOUT_MS, --print-timeout, and explicit loop caps) so a stalled headless task cannot burn a monthly budget overnight.

5. Stabilize prompt-cache prefixes: keep static system instructions and CLAUDE.md / AGENTS.md files unchanged across runs and clear or compact stale context between tasks to preserve 90%+ cache-read discounts ($0.01–$0.10/M tokens vs. $0.10–$2.00/M uncached).

Sources used in the report
  Claude ToS: the Terms of Service in plain English (2026) - Autonomee

  Use the Claude Agent SDK with your Claude plan

  Claude Pro/Max/Ultra vs API Key (Nov 2026): API Credits - QCode.cc

  Claude Code Usage Limits (2026) - Build This Now

  Are Claude Code Pro/Max subscriptions really restricted to non

  Is Claude Code Safe to Use at Work? A Decision Guide for 2026

  Consumer Terms of Service - Claude

  Usage limit best practices | Claude Help Center

  Our approach to rate limits for the Claude API | Claude Help Center

  Customize your status line - Claude Code Docs

  Manage costs effectively - Claude Code Docs

  I'm encountering 429 errors, and I'm worried my rate limit is too low

  Google Antigravity Ban - Google AI Developers Forum

  [This is bad] If you run "agy" while logged in with Claude Code, your

  Antigravity CLI suspended (no third-party OAuth client)

  [Discussion] A second ban wave just hit the antigravity - Reddit

  Addressing Antigravity Bans & Reinstating Access #20632 - GitHub

  Google AI Ultra - ToS Appeal - No response. Help with reinstatement

  Google Antigravity 256K Context Cap and Policy Reversal

  Gemini CLI: Quotas and pricing

  Gemini CLI Consumer Access Ended: What Still Works and How to

  Gemini 3.8 Flash Free Tier: repeated 429

  Codex API key vs subscription: cost, limits and switching - Contenox

  Codex Usage Limits and Pricing in 2026: Pro 100, Pro 200, Pro 500

  Codex Pricing 2026: Plans, Limits, API Cost - TwitterAPI.io

  Pricing - ChatGPT Learn

  Codex pricing by ChatGPT plan: Plus, Pro 100/200/500 and API keys

  Codex ChatGPT Login vs API Key: CLI Auth, Billing & Access

  Login with ChatGPT instead of bring your own token - API

  Pricing - Claude Platform Docs

  Prompt caching - Claude Platform Docs

  Optimizing for cost and intelligence - Claude Platform Docs

  Headless mode - Antigravity CLI

  Changes to Antigravity plans

  Gemini 4 Carbon and /swarm | Google Antigravity Blog

  Pricing | OpenAI API

  Terms of Use - OpenAI

  Europe Terms of Use - OpenAI

  Go | OpenCode Console

  Run Claude Code programmatically - Claude Code Docs

  Automate work with scheduled tasks - Claude Code Docs

  Run prompts on a schedule - Claude Code Docs

  Schedule recurring tasks in Claude Code Desktop

  Choose a permission mode - Claude Code Docs

  Claude Code Pro Account Suspended, and support not helping

  antigravity-auth/README.md at main - GitHub

  Multiple Google Services Restricted After Policy Violation Notices

  Is Google Antigravity Free? What the Free Plan Covers (2026)

  Paid Google AI Pro Subscriber: Antigravity 403 Suspension Past 76

  Is agy -p in Claude Code or Codex against Antigravity terms?

  Is using the unmodified Antigravity CLI (agy -p) through a personal

  Why I stopped using the configuration that called the Antigravity CLI

  Claude Code vs Antigravity CLI (2026): Anthropic's Agent vs Google's

  Antigravity CLI 403 after headless reviews run by my AI assistant; all

  OpenCode Banned by Anthropic: What Developers Need to Know

  Why 157,000 developers are hedging against Anthropic with

  Anthropic Locks Down Claude Subscriptions in Third-Party AI Tools

  Anthropic Banned Third-Party Claude Auth: Full Guide 2026 | KERSAI

  OpenAI ChatGPT Plus/Pro OAuth methods missing from `auth login

  Gemini API kostenloser Tarif 2026: Limits, Modelle und wann Kosten

  Is the Gemini 4 API free? Only Hydrogen has a free tier - Ofox AI

  Gemini API Rate Limits: Free Tier Quotas 2026 - TinkerLLM

  Suspended for using --prompt in Claude Code : r/Anthropic - Reddit

  Claude Account Suspended — What to Do: How to Appeal

  [DOCS] headless mode documentation does not warn it should not

  How to Avoid a Claude Code Ban: Safe Setup and Risk Checks

  Surface Anthropic consumer-terms constraint at OAuth selection +

  ChatGPT & Claude Ban Prevention: Rules and Appeals - AI Arte

  Sign in with ChatGPT Terms - OpenAI

  OpenCode Go: Limits, Models and How to Run It in the Cloud

  OpenCode Go Pricing and Limits (Nov 2026): $10, Plus $40

  OpenCode Go vs Zen (2026): Pricing, Limits and Free Models

  Don't choose OpenCode for free coding: its free models ... - Freebuff

  OpenCode "Free Usage Limit Reached" or "No Longer Supports

  OpenCode Go ($10/month): Hit 100% rolling usage within hours of

  Anthropic Claude Reverse-Engineering Repo Ban & OAuth Rules

  GPT-5.6 Sol in Claude Code — Claudex Guide | explainx.ai Blog

  Codex Rate Limit Discussion Thread - OpenAI Developer Community

  Codex Rate Limit Discussion Thread - OpenAI Developer Community

  ChatGPT and Codex Usage Limits by Plan: What Is Shared

  My codex session hit its subscription limit, then wrote its own

Sources read but not used
  Legal and compliance - Claude Code Docs

  Question: subscription limits for headless (-p / Agent SDK) use, and

  The Agent SDK Auth Scare (and Why You're Fine) - Yep Anywhere

  API and data retention - Claude Platform Docs

  Error reference - Claude Code Docs

  Claude Code GitHub Actions - Claude Code Docs

  Desktop application - Claude Code Docs

  Claude Developer Platform

  Troubleshoot installation and login - Claude Code Docs

  claude-code/CHANGELOG.md at main - GitHub

  Claude Developer Platform

  Common workflows - Claude Code Docs

  Consumer Terms of Service - Claude

  Legal Center - Anthropic

  OSS Scanner Terms & Conditions

  Anthropic's Transparency Hub

  Commercial Terms of Service - Claude

  Who owns and manages the data of my team?

  Updates to our Privacy Policy

  The Financial Services Guide to Building Autonomous AI Agents

  Terms of Service Updates - Anthropic Privacy Center

  Speed up responses with fast mode - Claude Code Docs

  Best practices for Claude Code - Claude Code Docs

  llms-full.txt - Claude Code

  Claude Code changelog - Claude Code Docs

  Antigravity Account Suspended: The Real Rules | Zentor Blog

  Antigravity login bans for omp and Pi agent users - DeepakNess

  Developer Fired by Google for Building Google Workspace CLI

  Service update: mitigating abuse and prioritizing traffic ... - GitHub

  Gemini Code Assist consumer accounts - Google for Developers

  Hands-on with Gemini CLI - Codelabs

  Gemini CLI Is No Longer Free: What Changed and Where to Go - yaw

  Rate limits - Gemini API - Google AI Studio

  Billing - Gemini API | Google AI Studio

  Release notes - Gemini API | Google AI Studio

  Pricing | Explore | ChatGPT Docs

  OpenAI Codex kostenlos? Kosten, Limits und Alternativen

  OpenCode in 2026: Installation, Go Pricing and Review - swanbase

  pi-subs-usage · Packages

  Introducing Claude Sonnet 5.5 - Anthropic

  Introducing Claude Haiku 5.5 - Anthropic

  Claude Fable - Anthropic

  Claude Sonnet 5.5 - Claude Platform Docs

  Claude Opus 5.5 - Claude Platform Docs

  Claude Opus - Anthropic

  Claude Model Pricing — List Prices by Platform - Anthropic

  IDE extensions | Google Antigravity Docs

  Changelog - Google Antigravity

  Changelog | Google Antigravity Docs

  Google Antigravity @ I/O 2026

  Google Antigravity built an OS (and more)

  Bringing Antigravity to Gemini Enterprise: Agentic workflows for

  Pricing - ChatGPT Learn

  Models - ChatGPT Learn

  Codex for Students - OpenAI Developers

  Rate limits | OpenAI API

  Changelog | OpenAI API

  Sites - ChatGPT Learn

  ChatGPT Learn

  Authentication - ChatGPT Learn

  ChatGPT & Codex changelog

  ChatGPT Learn

  Terms & policies - OpenAI

  Usage policies - OpenAI

  Service terms | OpenAI

  ChatGPT Wallet Privacy Notice - OpenAI

  OpenAI Data Processing Addendum

  Privacy policy - OpenAI

  Providers API - OpenCode

  Models | OpenCode Console

  Claude Sonnet 5 pricing, providers, and specs | Models.dev

  GPT-5.6 Luna pricing, providers, and specs - Models.dev

  Deep Research Max Preview pricing, providers, and specs

  Models | OpenCode

  CLI reference - Claude Code Docs

  Manage sessions - Claude Code Docs

  Common workflows - Claude Code Docs

  Keep Claude working toward a goal - Claude Code Docs

  How to Avoid Getting Banned on Your Claude Account ... - YouTube

  Claude Account Banned? Reasons, Appeals and Refunds - Proxy302

  Gemini API Additional Terms of Service - Google AI Studio

  Appeal for Antigravity ToS Suspension - Google AI Developers Forum

  Antigravity User Service Agreement

  Google Antigravity Pricing 2026: Is It Free? Limits and Plans - NxCode

  Google One support told me to "hope for the best" after Antigravity

  Do ChatGPT às IAs chinesas: quem são os rivais do Claude na corrida da inteligência artificial

  This is how Google's new AI chip strategy could end Nvidia's dominance in the AI market

  Vibe coding: qué es y cómo programar con IA sin saber código

  Gemini Developer API pricing - Google AI Studio

  Decisions API - Gemini API - Google AI Studio

  OpenCode vs. Claude Code: Which AI coding tool is best? [2026]

  ChatGPT / Claude Account Suddenly Banned? We Checked 23

  Anthropic explicitly blocks OpenCode in oauth : r/opencodeCLI

  Claude and Codex Subscription Bans Explained - QCode.cc

  Anthropic officially bans using subscription auth for third party use

  Rate limits - Gemini API - Google AI Studio

  there is NOTHING about oauth usage in third party apps ... - Reddit

  You might be breaking Claude's ToS without knowing it - Dev Genius

  Businesses in ChatGPT Terms - OpenAI

  Using ChatGPT agent in line with our policies - OpenAI

  Ad policies | OpenAI

  New Project Megathread - Week of 29 Oct 2026 : r/selfhosted - Reddit

  MCP tools - zindex docs

  Is Trae AI safe for company code? Terms, risks and controls

  Addressing Antigravity Bans and Reinstating Access - Hacker News

  AI Coding Tool News: Claude Code, Codex, Cursor | AI Catchup

  tuxevil-rotator - GitHub

  AI Security Incidents: Latest Breaches & CVEs | PointGuard AI

  [Feature]: Support multiple openai/codex subscriptions · Issue #65735

## Stage 2

Not received.
