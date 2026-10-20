# Twenty CRM sync (dogfooding)

`scripts/ops/crm/sync_to_twenty.py` copies Smart Judge customers into our own Twenty CRM
(`roxira_twenty_crm` on srv1, internal only). Nightly, idempotent, read-only on our database.

| Our data | Twenty object | Stable key |
| --- | --- | --- |
| Phone users (chat, paid orders) and email accounts, with plan + expiry (`user_entitlements`) | People (`emails`, `phones`, custom `plan`, `planExpiresAt`) | custom text `externalId` = `user_ref` (sha256 of `smartjudge:<phone>`, same id as the admin console) |
| Paid orders (`payment_orders`, status `paid`: amount, method zibal/usdt_trc20, date) | Opportunities (stage CUSTOMER, amount in IRR or USD, linked to the person) | custom text `externalId` = order `track_id` |
| Support tickets (`support_tickets`) | Notes linked to the person when the contact matches a phone/email | title marker `[rx-ticket:<code>]` |

The CRM is internal, so contact phone and email are stored in clear. A second run changes nothing
(fields we send are compared; extra fields on the Twenty side are ignored). Tickets are written once;
later admin replies are not re-synced. Nothing is ever deleted in Twenty.

## One-time setup (owner, in the Twenty UI)

1. Open the Twenty UI (via the SSH tunnel to the container port, it is not public) and create the workspace
   (first sign-up becomes its admin).
2. Settings -> Data model: add these custom fields (names are case-sensitive):
   - People: `externalId` (Text), `plan` (Text), `planExpiresAt` (Date and time)
   - Opportunities: `externalId` (Text)
3. Settings -> APIs & Webhooks -> Create API key (name `roxira-sync`, no expiry or 1 year). Copy it once.
4. On srv1 create `/etc/roxira-crm.env` (mode 600, root):
   ```
   TWENTY_API_KEY=<the key>
   TWENTY_API_URL=http://roxira_twenty_crm:3000
   ```
   Use `scripts/ops/set_server_env.sh` style entry so the key never appears in chat or in git.
5. Check the app container and Twenty share a Docker network (`docker network inspect` should list both
   `roxira_app_prod` and `roxira_twenty_crm`); if not, `docker network connect <net> roxira_twenty_crm`.

## Dry run, then enable

```
# dry run: reads Postgres only, never calls Twenty, prints counts
ssh roxira-prod 'docker exec -i -w /app -e PYTHONPATH=/app roxira_app_prod python3 - < /opt/roxira_platform/scripts/ops/crm/sync_to_twenty.py'

# first real write (loads the key from the env file)
ssh roxira-prod 'set -a; . /etc/roxira-crm.env; set +a; docker exec -i -w /app -e PYTHONPATH=/app -e TWENTY_API_KEY -e TWENTY_API_URL roxira_app_prod python3 - --apply < /opt/roxira_platform/scripts/ops/crm/sync_to_twenty.py'

# nightly timer, 03:30 UTC
sudo install -m 644 scripts/ops/crm/roxira-crm-sync.service scripts/ops/crm/roxira-crm-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now roxira-crm-sync.timer
systemctl list-timers roxira-crm-sync.timer
```

Output is one JSON line: `{"mode", "stats": {people|opportunities|notes: {create, update, same}}, "source_errors"}`.
`source_errors` lists source tables that were missing (the sync continues without them).

## Notes and caveats

- The Twenty REST payload shapes (`name`, `emails`, `phones`, `amount`, `bodyV2`, `noteTargets`) follow the
  Twenty REST API at the time of writing and were tested only against a fake client. Run the first
  `--apply` by hand and check the result in the UI before enabling the timer; if Twenty rejects a field,
  adjust the `*_payload` functions.
- Without `/etc/roxira-crm.env` the unit fails (exit 2, refuses `--apply`) rather than silently doing nothing.
- Tests: `python3 -m pytest scripts/ops/crm/tests -q` (fake Twenty client and fake DB connection).
