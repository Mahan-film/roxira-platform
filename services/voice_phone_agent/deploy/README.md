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
sudo phone-stack up
sudo phone-stack status     # OK/FAIL lines: 4 containers, 2 units, LiveKit, TTS sidecar,
                            # synthetic TTS path, SIP registration (one word)
sudo phone-stack logs 200   # filtered: no env, keys, numbers or IPs
sudo phone-stack down
```

To update the agent: merge to main, `git fetch`, run `05_root_phone_stack.sh` again (it keeps `.env` and
the extracted bundle), then `sudo phone-stack up`.

Open: a pinned-digest compose file in git that mounts the bundle's configs (after the first run shows
the bundle's images and service names).

Notes: `phone-stack logs` drops whole lines that mention keys, tokens or env on purpose: safety over
detail. `box-proxy on` stays on after `up`, because all traffic on the box goes through the proxy
(owner, 2026-11-19). User `phone` is in the system `docker` group (root-equivalent); this is on the
final hardening list in `docs/ops/LINUX_CI_BOX.md`.
