# SBOM and vulnerability summary

`scripts/ops/sbom/sbom_scan.sh` (daily timer `roxira-sbom`, 04:15 UTC, installed by
`scripts/ops/sbom/install.sh --apply`) lists every package inside the four production images
(app, backend, frontend, key pool) as an SPDX SBOM and checks them for known vulnerabilities.

- Scanners: `anchore/syft:v1.54.1` (SBOM, runs with `--network none` on an exported image tar; no
  docker socket is given to it) and `anchore/grype:v0.120.1` (vulnerabilities; downloads its DB into
  `/var/cache/roxira-grype-db`).
- Output: `/root/deploy-state/sbom/<container>-<image12>.spdx.json` and `.vulns.json` (newest 3
  kept per container) and `/root/deploy-state/sbom/summary.txt` (counts + top 5 Critical/High with
  the fixed-in version).
- Report-only: never blocks a deploy. Containers with Critical findings are sent to the owner bot.
- Run once: `systemctl start roxira-sbom.service`.
- Act on it: bump the package (or base image) to the fixed-in version in a normal PR.
