# Reachability matrix

`scripts/ops/reachability_matrix.py` checks a fixed, non-sensitive list of public
endpoints. It records IPv4 DNS answers, marks answers in `10.10.34.0/24` or
`10.10.35.0/24` as `filtered_dns`, and makes an unauthenticated HTTPS `HEAD`
request with an 8-second timeout. The request has no headers or credentials, and
the script stores neither.

Run on the Mac:

```console
python3 scripts/ops/reachability_matrix.py --format table
python3 scripts/ops/reachability_matrix.py > reachability-mac.json
```

Run the identical commands on the server, changing the output name to
`reachability-server.json`. Copy the two JSON files to a safe workstation and
compare each `results` entry by `endpoint`: DNS addresses and `filtered_dns`
show resolver differences; `status_code`, `error`, and `latency_ms` show HTTPS
reachability differences. The script always exits zero so scheduled collection
continues; use `--fail-on-filtered` when a filtered DNS answer should fail a job.
