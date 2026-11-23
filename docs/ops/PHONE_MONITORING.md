# Phone line monitoring and hardening plan (work package G)

Refs #1115 (SIP registration), #1119 (nightly voice test), #989 / #987 (Smart Judge phone answers), #1087 (LiveKit key pair).
Pack: `scripts/ops/ci_box/status_page/` (stacked on the status page of work package J, `docs/ops/BOX_STATUS_PAGE.md`).
Tests: `src/ops/test_phone_probes.py` (offline). Stdlib Python only. Nothing here changes the phone stack, ufw, nftables or sudoers.
Public repo rule: the line is "the carrier"; no key, address, host, number or personal name appears here, in fixtures or in alert text.

## What was reused
`box_status.collect` and the HTML page (a new "phone line" panel), `box_alert` (failure-only Telegram, 3 h cooldown per check, one message per incident,
unknown source = no incident, no-op while the env file is missing or loose), `monitor_common.evaluate` and `notify.send`. New code is only the probes
(`phone_probes.py`), small hooks in `box_status.py` and `box_alert.py`, and an optional least-privilege signals producer.

## What is monitored
| Probe | Source (lane user unless noted) | Alert (Telegram, failure only) |
|---|---|---|
| SIP registration | `asterisk -rx "pjsip show registrations"` via `docker exec`, status word only | any row not `Registered`; no rows = no check |
| UDP keepalive / qualify | `pjsip show contacts`, non-loopback contact, status word and RTT | `Unavail` or `NonQual` (the `qualify_frequency` fix was lost) |
| Container health | `docker ps/inspect`, found by image (no names in git) | not running, `unhealthy`, or a role missing while others exist (e.g. removed by `phone-stack down`) |
| Container restart loop | `RestartCount` delta between runs | 3 or more restarts since the last run |
| Agent and TTS unit | `systemctl show` (`ActiveState`, `NRestarts`) | not active; 3 or more `NRestarts` since the last run (a crash loop that `active` alone hides) |
| LiveKit health | loopback HTTP, proxy bypassed | anything but HTTP 200; same for the TTS sidecar |
| Carrier drops in ufw | signals file (needs adm group, see below): `[UFW BLOCK]` to the SIP ports from non-private sources | any in the last hour |
| Last inbound call | signals file (journal), else the bridge call counter seen to move | display only; `PHONE_CALL_STALE_H` turns an alert on |
| First-audio latency | real turns: display only. Nightly test report (below): p50 above `PHONE_FIRST_AUDIO_TARGET_MS` (1500) | only once the nightly report exists |
| Call setup latency | **not logged anywhere today**; reserved field `setup_ms` in the nightly report | none yet |
| Log growth | `docker logs --since 1h` (stdout and stderr, bytes counted in the shell), extrapolated per day | above `PHONE_LOG_MB_DAY` (100) for one container |
| Recordings | `find` in the bridge's monitor and recording dirs (not the agent's own debug recorder) | any file (the no-real-customer-data rule) |
| Signals producer alive | age of the signals file | older than 20 min (only when the file exists) |
Existing alerts from the status page (disk 85 percent, failed units, tunnel) stay as they are.

Nightly voice test: none exists yet (`smoke.ts` is a manual offline pipeline run). Contract for the future test (#1119), a JSON file at
`/srv/data/phone/voice-test/latest.json` (`PHONE_VOICE_REPORT`): `{"ts": <unix s>, "setup_ms": {"p50": n, "p95": n}, "first_audio_ms": {"p50": n, "p95": n}}`.
Present = stale after 36 h alerts, p50 over target alerts. Until the latency target is met, enabling it will alert; that is a true failure, not noise.
The R30 second opinion adds TTS leading silence, barge-in cancel time, trunk TLS certificate expiry and a "no audio stored after declined recording" assertion:
none of these is read yet (they need the test and a TLS trunk first).

## Privacy of the probes
Parsers keep status words, counts, timestamps and `*_ms` numbers. Container names, carrier host, source addresses, room names (they contain the caller number)
and transcripts are used in memory or not read at all; tests assert that the snapshot, the page, the signals file and alert text contain no dotted quad,
no long digit run and no room name.

## Owner steps (one command each)
1. Reinstall the status pack as the lane user (it copies `phone_probes.py`; all probes except firewall and journal ones work at once):
   `bash /home/mahanfilms/roxira-platform/scripts/ops/ci_box/status_page/install_user.sh --apply`
2. Firewall and call probes need read access to the adm-only ufw log and the system journal. The least-privilege way is a sandboxed system timer under a new
   no-login user (adds no existing user to a group): read the plan with `sudo bash /home/mahanfilms/roxira-platform/scripts/ops/ci_box/status_page/install_phone_signals_root.sh`,
   then apply with `--apply`. Optional `/etc/roxira-phone/signals.env` (mode 600, never in git): `PHONE_CARRIER_CIDRS=<carrier networks>` counts only carrier drops.
3. Telegram: same file as the status page (`~/.config/roxira-status/telegram.env`, mode 600). Without it nothing is collected or sent.
4. Not now, only when the phone package starts: the carrier registration details and the carrier's signalling networks. No agent asks for them before that.
Tests of the pack: `~/venvs/roxira/bin/python -m pytest src/ops/test_phone_probes.py src/ops/test_box_status.py`.

## Hardening list for a paying customer
Ordered by risk. Items marked (owner) need a root or network change by the owner; none was done here.
1. **Key pair (#1087)**: run `sudo phone-stack keys check`; if it fails, `rotate`, then `up`. Do this before the line is reachable by anyone else.
2. **Ethernet instead of Wi-Fi** (owner; already planned): retest SIP after the move; the carrier qualify RTT on the status page is the before/after number.
3. **Redis**: bind to loopback and set a password; LiveKit and the agent share it. Check which stack ports listen on all interfaces. Also check the Redis licence of the floating `7-alpine` tag (releases after 7.2 are not BSD,
   see the licence audit) and prefer a BSD fork or a pinned 7.2 image.
4. **Listeners and ufw** (owner): close 4520/4569/5000 and the sample dialplan/IAX in the bridge image; allow SIP/RTP only from the carrier networks (ufw, once they are known);
   keep LiveKit 7880/7881 off the LAN unless a browser client needs them. If the carrier sends INVITEs from an address other than the registrar's, the keepalive's conntrack entry does not match them: add an explicit allow for that source;
   the new ufw-drop probe shows when that happens.
5. **Registrar choice**: LiveKit SIP does not register by itself (R30), so registration lives in the Asterisk bridge, a second moving part. For a paying line prefer an
   IP-authenticated EU trunk (R30 D1) that sends INVITEs straight to LiveKit and removes the bridge; keep the bridge only for the local market.
6. **TLS and SRTP**: check `media_encryption` and the transports on the carrier endpoint (UDP without TLS and plain RTP is the default). Ask the carrier for SIP-TLS + SRTP, enable `TLS` transport and
   `media_encryption=sdes` (or DTLS) on the carrier endpoint, then monitor certificate expiry in the nightly test (R30 second opinion). Verify the carrier supports it first.
7. **SIP scanning protection**: an open SIP port gets scanned. First choice is no tool: source-restrict the port (item 4) plus `ufw limit` on 5060/5062. If a tool is wanted,
   check its licence against the repo rule first: fail2ban is GPL-2.0-or-later (already used on the production host as an OS tool, not shipped), CrowdSec's engine is MIT (verify
   against the repo before naming), SIPVicious-style tools are for testing only. Asterisk needs a `security` log channel before any of them can read failed-auth events.
   The new ufw-drop probe is the early warning in the meantime.
8. **Dead-call and toll abuse**: set `rtp_timeout` and `rtp_timeout_hold` (default 0 = a dead call never ends), and the cost and per-number caps of R30 row 8 (alert at 80 percent).
9. **Recording retention and the data rule**: `DEBUG_RECORD_CALLERS` stays off; no recording without opt-in; transcripts redacted and deleted at the set age (R30: default 30 days);
   the monitor alerts on any recording file in the bridge. The agent logs the room name (it holds the caller number) and transcript text to the journal: rotate it short, or stop
   logging them before real callers exist. **No real customer data on this box** until a production host exists (it is a laptop with Wi-Fi, a shared
   Docker group and test keys).
10. **Operational**: pin image digests; set `log-opts` max-size and max-file in the Docker daemon config (owner) and enable `live-restore` so a daemon restart does not drop calls;
    keep user `phone` out of the docker group (root-equivalent) or move to rootless Docker; a two-box or hosted fallback for the single trunk and single laptop (R30 risk list).

## Not verified
- The signals producer and its unit were checked with `systemd-analyze verify` and a read-only run of the parser against the real ufw log and journal as an adm member;
  the installer was only dry-run, and the system timer was never installed or run. Access of the new user to the ufw log and journal is expected from the group rules, not tested.
- No alert was sent to Telegram (no credentials on this box); delivery through the proxy is untested. A live full `collect` as the lane user worked.
- The carrier's signalling networks; carrier support for TLS/SRTP and IP trunks;
  the exact LiveKit SIP log lines for an inbound call (the call time comes from the agent journal, which was verified, not from LiveKit SIP logs).
- The unit journal and `phone-stack logs` are not machine readable for timing without the signals producer. Setup latency has no source at all.
- CrowdSec licence and the Redis licence of the pulled tag were not checked on a primary source here. The agent's own debug-recording path was not inspected.
