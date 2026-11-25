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
                            # contact qualify (one word each)
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

## SIP Trunk NAT Traversal & 7-Day Registration Runbook (#1115 / T292)

LiveKit SIP does not send SIP `REGISTER` requests to telecom providers; it acts as an inbound trunk listener
and outbound gateway. The SIP registration with the carrier lives entirely inside the Asterisk bridge container
(`lk-sabanet-bridge`).

### Why SIP shows "Unregistered" behind NAT
1. **Unroutable Contact Header**: When Asterisk runs inside a Docker bridge network (`172.18.0.0/16`) behind
   a host NAT, it advertises its private internal IP in `Via` and `Contact` headers unless RFC 1918 subnets are
   declared in `local_net`. The carrier's registrar replies to the unroutable private address.
2. **NAT Conntrack Expiration**: Outbound SIP REGISTER over UDP opens a stateful tracking entry in the router
   and host `ufw`. Without bidirectional traffic, the state entry expires in 30–60 seconds, causing incoming calls
   and renewal responses to be dropped. `qualify_frequency=20` sends periodic SIP OPTIONS to keep the port open.
3. **Premature Retry Termination**: By default, Asterisk stops attempting registration after 10 failed attempts
   (`max_retries=10`) and permanently gives up on HTTP 403 Forbidden (`forbidden_retry_interval=0`). Any transient
   network blip or carrier reload leaves Asterisk permanently stuck in `Unregistered` or `Rejected`.
4. **Symmetric RTP & Port Mismatches**: Carrier NAT routers rewrite the source port. Without `rtp_symmetric=yes`
   and `force_rport=yes`, media and signaling responses are directed to the wrong port, resulting in silent drops.

### Automated NAT Configuration in `pjsip.conf`
`05_root_phone_stack.sh` invokes `pjsip_nat_config.py` to idempotently configure:
- **`[transport-...]`**: `local_net=127.0.0.1/32`, `local_net=10.0.0.0/8`, `local_net=172.16.0.0/12`, `local_net=192.168.0.0/16`.
- **`[..._endpoint]`**: `rtp_symmetric=yes`, `force_rport=yes`, `rewrite_contact=yes`, `direct_media=no`.
- **`[..._reg]`**: `max_retries=10000`, `retry_interval=60`, `forbidden_retry_interval=300`, `fatal_retry_interval=300`.
- **`[..._aor]`**: `qualify_frequency=20`.

### Diagnostic Commands (Safe, Non-Destructive)
```bash
# Verify current registration and carrier qualify
sudo phone-stack sip-check

# Check or tune pjsip.conf NAT compliance
sudo phone-stack nat-check
sudo phone-stack nat-tune

# Asterisk CLI inspection inside the container
docker exec lk-sabanet-bridge asterisk -rx "pjsip show registrations"
docker exec lk-sabanet-bridge asterisk -rx "pjsip show contacts"

# Live SIP packet tracing (does not restart Asterisk)
docker exec lk-sabanet-bridge asterisk -rx "pjsip set logger on"
# (disable after inspection):
docker exec lk-sabanet-bridge asterisk -rx "pjsip set logger off"

# Reload pjsip configuration without dropping active calls
docker exec lk-sabanet-bridge asterisk -rx "pjsip reload"
```

### 7-Day Registration Stability Goal
A nightly cron runs `/usr/local/lib/phone-stack/check_sip_registration.py --alert`.
- Status is recorded in `/srv/data/phone/state/sip_registration_history.json`.
- Alerts are dispatched immediately if state changes away from `Registered`.
- Goal: `pjsip show registrations` maintains continuous `Registered` state for `>= 7.0` days (168 hours).
Full runbook: `docs/ops/SIP_NAT_TRUNK_RUNBOOK.md`.

Open: a pinned-digest compose file in git that mounts the bundle's configs (after the first run shows
the bundle's images and service names).

Notes: `phone-stack logs` drops whole lines that mention keys, tokens or env on purpose: safety over
detail. `box-proxy on` stays on after `up`, because all traffic on the box goes through the proxy
(owner, 2026-11-19). User `phone` is in the system `docker` group (root-equivalent); this is on the
final hardening list in `docs/ops/LINUX_CI_BOX.md`.
