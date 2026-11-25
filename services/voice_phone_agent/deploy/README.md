# Phone stack on roxira-ci (user `phone`)

The Smart Judge phone line runs on the Linux box `roxira-ci` (`docs/ops/LINUX_CI_BOX.md`,
`docs/ops/LAPTOP_HANDOFF_2026-11-18.md`). No secret, phone number or IP address belongs in git.

| Part | Where |
|---|---|
| LiveKit stack (`lk-redis`, `lk-server`, `lk-sip`, `lk-sabanet-bridge`) | `/srv/data/phone/voice-ai`, root-owned (from the owner's bundle; the compose file and the credential-bearing configs travel outside git) |
| Agent (Node, built from `origin/main`) | `/srv/data/phone/agent`, `.env` mode 600 |
| edge-tts sidecar venv | `/srv/data/phone/venv` |
| Units | `voice-ai-agent.service`, `voice-ai-tts.service` (user `phone`) |
| Wrapper | `/usr/local/bin/phone-stack up\|down\|status\|logs [lines]` (root-owned) |
| Health check | `healthcheck.sh` (installed root-owned at `/usr/local/lib/phone-stack/`) |

Network: LiveKit, SIP and the carrier line stay direct. The agent's foreign AI APIs (Groq, OpenAI,
Microsoft TTS) go through the box proxy: the units set `PROXY_URL=http://127.0.0.1:10809`, and
`src/http.ts` chooses proxy or direct per request. Image pulls the box cannot reach directly (Docker
Hub) go through `box-proxy on`. `phone-stack up` switches it on when a pull fails.

## Commands
```bash
# once, as root (after this PR merged and `git fetch` ran in ~mahanfilms/roxira-platform):
sudo bash /home/mahanfilms/roxira-platform/scripts/ops/ci_box/05_root_phone_stack.sh
# then as mahanfilms (sudoers allows only this wrapper):
sudo phone-stack keys check    # lengths only; FAIL if the public LiveKit dev pair is in use
sudo phone-stack keys rotate   # random openssl pair -> agent env (600) + stack configs; then `up`
sudo phone-stack up            # refuses to start while the dev pair is present
sudo phone-stack status     # OK/FAIL lines: 4 containers, 2 units, LiveKit, TTS sidecar,
                            # synthetic TTS path, SIP registration and carrier
                            # contact qualify (one word each), and cost caps
sudo phone-stack costs      # Phone cost audit & abuse caps report
sudo phone-stack costs --simulate-call 120 # Simulate call duration with carrier rounding
sudo phone-stack logs 200   # filtered: no env, keys, numbers or IPs
sudo phone-stack down
```

To update the agent: merge to main, `git fetch`, run `05_root_phone_stack.sh` again (it keeps `.env` and
the extracted bundle), then `sudo phone-stack up`.

SIP routing (#1039): on every start the agent makes sure LiveKit has the inbound trunk
`roxira-local-bridge` (calls only from `127.0.0.1/32`, i.e. the local Asterisk bridge) and an individual
dispatch rule with the agent's room prefix bound to it, reusing existing ones and retrying until LiveKit
answers; both live only in LiveKit's Redis. Optional `SIP_TRUNK_NUMBERS` (comma list) limits the trunk to
those called numbers; empty means LiveKit's default trunk (any called number). The installer also keeps
`qualify_frequency=20` under `[sabanet_aor]` in the bundle's `pjsip.conf`: the OPTIONS pings keep the
carrier's UDP path through the host firewall open, so inbound INVITEs are not dropped.

Open: a pinned-digest compose file in git that mounts the bundle's configs (after the first run shows
the bundle's images and service names).

## Phone Cost Caps & Abuse Prevention (T298 / R30)
Telephony and cloud speech pricing is loaded from effective-dated configuration (`config/phone_pricing.json`).
Features:
- **Per-number daily caps**: 5 calls/day, max 1,800s (30m) connected audio per caller. Excess calls are refused with busy/prompt.
- **Global daily limits**: 200 calls/day, max 36,000s (10h) connected audio.
- **Monthly spend cap**: USD 1,000.00 ceiling. When spend reaches 80% (USD 800.00), an alert is triggered in the box status page and logs.
- **Pricing models**:
  - LiveKit Cloud Scale plan ($500/mo EU pinning, $0.01 agent-min, $0.01 obs-min, 10s min duration).
  - Carrier minute rounding: 60/60 rounding on Telnyx, Twilio, and sipgate vs 1/1 per-second on easybell.
- State is persisted at `/srv/data/phone/state/phone_usage_state.json`.

Notes: `phone-stack logs` drops whole lines that mention keys, tokens or env on purpose: safety over
detail. `box-proxy on` stays on after `up`, because all traffic on the box goes through the proxy
(owner, 2026-11-19). User `phone` is in the system `docker` group (root-equivalent); this is on the
final hardening list in `docs/ops/LINUX_CI_BOX.md`.
