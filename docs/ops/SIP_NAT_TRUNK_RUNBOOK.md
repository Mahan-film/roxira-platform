# SIP Trunk NAT Traversal and 7-Day Registration Runbook (#1115 / T292)

## 1. System Overview and Topology

The Smart Judge phone service connects callers to the autonomous voice agent over a SIP trunk
provided by the telecom carrier. The bridge architecture on the `roxira-ci` Linux box is structured as:

```text
[Carrier SIP Registrar / SBC]
       │
       ▼ (UDP 5060 / WAN IP)
[Host Firewall (UFW) + Docker NAT]
       │ (Port 5062 forwarded or host network)
       ▼
[Asterisk Bridge (lk-sabanet-bridge)]
  - Sends SIP REGISTER to Carrier
  - Handles NAT traversal, symmetric RTP, and OPTIONS keepalive
       │
       ▼ (SIP loopback UDP 5060 / RTP 10000-20000)
[LiveKit SIP Gateway (lk-sip)]
       │
       ▼ (Internal WebRTC / Redis room dispatch)
[LiveKit Server (lk-server)]
       │
       ▼ (WebSocket localhost:7880)
[Phone Agent (voice-ai-agent.service)]
```

> [!IMPORTANT]
> **Key Architectural Distinction**:
> LiveKit SIP does **NOT** register to third-party carrier SIP trunks (per official LiveKit SIP docs).
> Registration to the carrier trunk is handled solely by the Asterisk container (`lk-sabanet-bridge`).
> An "Unregistered" status originates in Asterisk's PJSIP client.

---

## 2. Root Cause Analysis: Why Asterisk Becomes "Unregistered" Behind NAT

When Asterisk is deployed in a Docker container or behind router NAT, four distinct mechanisms can
cause `pjsip show registrations` to report `Unregistered`, `Rejected`, or `Retry Wait`:

### A. Missing RFC 1918 `local_net` Definitions
- **Symptom**: Outbound `REGISTER` packets contain the container's private IP (`172.18.0.x`) in the `Contact`
  and `Via` headers. The carrier registrar accepts the packet but sends its `200 OK` or `401 Unauthorized` challenge
  back to the unreachable internal IP.
- **Resolution**: Configure `local_net` for all private subnets (`127.0.0.1/32`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`) in the PJSIP transport section. Asterisk then uses the host's routable IP or STUN-resolved IP
  when communicating outside the local subnets.

### B. UDP Conntrack State Timeout
- **Symptom**: Asterisk registers successfully on startup, but drops to `Unregistered` or fails to receive
  inbound calls after 30 to 60 seconds of silence.
- **Cause**: Linux `netfilter` / `ufw` connection tracking entries for UDP expire after 30 seconds of inactivity.
  When the carrier sends an inbound `INVITE` or a registration refresh probe, the firewall drops it (`UFW BLOCK`).
- **Resolution**: Set `qualify_frequency = 20` under `[sabanet_aor]`. Asterisk sends periodic `SIP OPTIONS` pings
  every 20 seconds, continuously refreshing the conntrack table entry.

### C. Default Retry Expiry on Transient Errors
- **Symptom**: A momentary network disruption or carrier maintenance causes Asterisk to enter `Unregistered` or
  `Rejected` and never attempt to reconnect.
- **Cause**: In Asterisk res_pjsip:
  - Default `max_retries = 10`: Asterisk stops trying after 10 attempts.
  - Default `forbidden_retry_interval = 0`: Asterisk **permanently ceases retrying** if the carrier returns `403 Forbidden`
    (e.g., temporary rate-limit or token re-verification).
  - Default `fatal_retry_interval = 0`: Asterisk permanently ceases retrying on any fatal response.
- **Resolution**: Set `max_retries = 10000`, `retry_interval = 60`, `forbidden_retry_interval = 300`, and
  `fatal_retry_interval = 300`. This guarantees continuous retry resilience.

### D. Asymmetric RTP and Dynamic Carrier Ports
- **Symptom**: Registration succeeds, but callers experience one-way audio, silent calls, or immediate disconnects.
- **Cause**: Many carriers rewrite source ports or use distinct media endpoints.
- **Resolution**: Configure endpoint flags:
  - `rtp_symmetric = yes`
  - `force_rport = yes`
  - `rewrite_contact = yes`
  - `direct_media = no`

---

## 3. Configuration Reference (`pjsip.conf`)

The automated tuner script `pjsip_nat_config.py` applies the following configuration blocks:

```ini
; Transport configuration
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5062
local_net=127.0.0.1/32
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
; Optional external addresses if static:
; external_signaling_address=x.x.x.x
; external_media_address=x.x.x.x

; Carrier endpoint
[sabanet_endpoint]
type=endpoint
transport=transport-udp
context=from-carrier
disallow=all
allow=alaw,ulaw
aors=sabanet_aor
outbound_auth=sabanet_auth
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
direct_media=no

; Address of record (AOR)
[sabanet_aor]
type=aor
contact=sip:carrier_host:5060
qualify_frequency=20

; Registration to carrier
[sabanet_reg]
type=registration
transport=transport-udp
outbound_auth=sabanet_auth
server_uri=sip:carrier_host:5060
client_uri=sip:carrier_user@carrier_host:5060
retry_interval=60
forbidden_retry_interval=300
fatal_retry_interval=300
max_retries=10000
expiration=120
```

---

## 4. Operational Commands & Diagnostic Triage

All commands are safe, non-destructive, and respect repository privacy guidelines (no passwords, numbers, or IPs printed).

### Checking Registration and Qualify
```bash
# 1. Quick status via phone-stack wrapper
sudo phone-stack status

# 2. Detailed registration check with 7-day stability evaluation
sudo phone-stack sip-check

# 3. Direct Asterisk CLI query inside bridge
docker exec lk-sabanet-bridge asterisk -rx "pjsip show registrations"
docker exec lk-sabanet-bridge asterisk -rx "pjsip show contacts"
```

Expected healthy output:
```text
=== SIP Trunk Registration & NAT Status ===
Bridge Container:     lk-sabanet-bridge
Registration Status:  Registered
Carrier Qualify:      Avail (5.2 ms)
Continuous Uptime:    7.45 days (643680 seconds)
7-Day Stability Goal: MET (>= 7 days)
Transitions:          None recorded (clean uptime)
```

### Auditing and Applying NAT Tuning
```bash
# Audit pjsip.conf for NAT compliance (non-modifying)
sudo phone-stack nat-check

# Apply NAT traversal and retry resilience tuning in place
sudo phone-stack nat-tune

# Reload Asterisk PJSIP without interrupting active calls
docker exec lk-sabanet-bridge asterisk -rx "pjsip reload"
```

### Live SIP Signaling Trace
To diagnose carrier rejection or handshake drops without restarting:
```bash
# Enable PJSIP packet logging to Asterisk console
docker exec lk-sabanet-bridge asterisk -rx "pjsip set logger on"

# View live SIP messages (filter with grep as needed)
docker exec lk-sabanet-bridge asterisk -rx "pjsip set logger on" && \
  docker logs --follow --tail 50 lk-sabanet-bridge

# Turn logger off when done
docker exec lk-sabanet-bridge asterisk -rx "pjsip set logger off"
```

### Checking Firewall Drops
```bash
# Check if UFW is dropping UDP traffic on SIP ports
sudo grep -iE "DPT=(5060|5062)" /var/log/ufw.log | tail -n 20
```

---

## 5. 7-Day Continuous Registration Stability Goal

The compliance target for Issue #1115 is:
> `pjsip show registrations` shows `Registered` continuously for 7 days without dropouts.

### Monitoring Setup:
1. The cron or systemd timer executes `/usr/local/lib/phone-stack/check_sip_registration.py --alert` every hour.
2. The state is tracked in `/srv/data/phone/state/sip_registration_history.json`.
3. If registration status transitions from `Registered` to `Unregistered` or `Rejected`, an immediate alert is generated.
4. When `consecutive_registered_days >= 7.0`, the 7-day stability flag is confirmed:
   ```json
   {
     "consecutive_registered_days": 7.12,
     "consecutive_registered_seconds": 615168.0,
     "current_status": "Registered",
     "seven_day_stable": true
   }
   ```
