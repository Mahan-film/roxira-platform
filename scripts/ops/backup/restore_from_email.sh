#!/usr/bin/env bash
# Rebuild and decrypt an "offsite by e-mail" backup from the downloaded attachments.
#   restore_from_email.sh --dir <folder with *.partNN + offsite-manifest-*.json> --key backup-age.key [--out <dir>]
# Steps: verify every part's SHA-256 against the manifest -> concatenate -> verify whole-file SHA-256 ->
# age -d -> tar -xz into --out (default ./restored). It never touches a live database: it prints the
# pg_restore commands to run yourself. Needs: bash, python3, age, tar, sha256sum or shasum.
set -euo pipefail
DIR="" KEY="" OUT="./restored"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -d "$DIR" ] || { echo "--dir must be a folder with the downloaded parts" >&2; exit 2; }
[ -r "$KEY" ] || { echo "--key must be the age private key file (backup-age.key)" >&2; exit 2; }
command -v age >/dev/null || { echo "age not installed" >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
MAN="$(ls "$DIR"/offsite-manifest-*.json 2>/dev/null | sort | tail -1 || true)"
[ -n "$MAN" ] || { echo "no offsite-manifest-*.json in $DIR" >&2; exit 2; }
# one line per part: name<TAB>sha256 ; first line: whole-file name<TAB>sha256 ; status check
LINES="$(python3 -I - "$MAN" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
if m.get("status") != "OK" or not m.get("parts"):
    sys.exit("manifest status is %s (%s): there is nothing to restore from this mail" % (m.get("status"), m.get("note")))
print("%s\t%s" % (m["source"]["name"], m["source"]["sha256"]))
for p in sorted(m["parts"], key=lambda x: x["index"]):
    print("%s\t%s" % (p["name"], p["sha256"]))
PY
)"
WHOLE_NAME="$(echo "$LINES" | head -1 | cut -f1)"; WHOLE_SHA="$(echo "$LINES" | head -1 | cut -f2)"
mkdir -p "$OUT"; JOINED="$OUT/$WHOLE_NAME"; : >"$JOINED"
while IFS=$'\t' read -r name want; do
  f="$DIR/$name"
  [ -f "$f" ] || { echo "MISSING part: $name (download it from its e-mail)" >&2; rm -f "$JOINED"; exit 3; }
  got="$(sha "$f")"
  [ "$got" = "$want" ] || { echo "CHECKSUM MISMATCH for $name" >&2; rm -f "$JOINED"; exit 3; }
  echo "ok  $name"
  cat "$f" >>"$JOINED"
done < <(echo "$LINES" | tail -n +2)
[ "$(sha "$JOINED")" = "$WHOLE_SHA" ] || { echo "whole-file checksum mismatch" >&2; rm -f "$JOINED"; exit 3; }
echo "joined file verified: $JOINED"
age -d -i "$KEY" "$JOINED" | tar -xz -C "$OUT"
echo "extracted into $OUT"
cat <<MSG
Next (manual, nothing was restored for you):
  Postgres dumps are under the extracted .../pg/<container>/<db>.dump ; globals.sql holds roles.
    docker exec -i <postgres-container> pg_restore -U <user> -d <db> --clean --if-exists < <db>.dump
  Config files (.env, compose, nginx) are under their original absolute paths inside $OUT.
MSG
