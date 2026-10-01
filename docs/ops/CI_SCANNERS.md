# CI scanner reports

CI runs Trivy filesystem scanning and the focused Semgrep rules in report-only
mode. Their findings do not block a PR or the automatic deployment yet.

Open the `trivy-fs-report` artifact on the workflow run to review Trivy's
HIGH/CRITICAL vulnerability, secret, and misconfiguration results. Read the
Semgrep job log for findings from the custom rules: Python `shell=True`, exposed
`NEXT_PUBLIC_` secret-like names, and NestJS controller repository imports.

An owner may make one scanner blocking only after it has had zero findings for
two consecutive weeks. At that point, remove its `continue-on-error` setting and
add the job to the repository ruleset's required checks.
