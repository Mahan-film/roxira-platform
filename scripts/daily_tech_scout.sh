#!/usr/bin/env bash
# ==============================================================================
# Roxira Daily Technology Scout (Tech Radar Agent)
# ==============================================================================
# پایش خودکار روزانه فناوری‌های مرتبط با هوش مصنوعی، NestJS، Next.js و
# پایگاه‌های داده. این اسکریپت برای اجرا از کرون‌جاب طراحی شده است:
#
#   30 4 * * * /opt/roxira_platform/scripts/daily_tech_scout.sh >> /var/log/roxira_tech_scout.log 2>&1
#
# خط لوله (src/automation/tech_radar.py):
#   Tavily/Exa/Brave -> Firecrawl/Jina Reader -> Jina Reranker -> deepseek-v4.1-flash
#
# خروجی‌ها:
#   - TECH_RADAR_REPORT.md / TECH_RADAR_REPORT.json  (گزارش رسمی ریشه پروژه)
#   - data/tech_radar/digest_<timestamp>.json         (تاریخچه برای API)
# ==============================================================================

set -euo pipefail

PROJECT_ROOT="${ROXIRA_PROJECT_ROOT:-/opt/roxira_platform}"
PYTHON_BIN="${ROXIRA_PYTHON_BIN:-python3}"
LOCK_FILE="${ROXIRA_TECH_RADAR_LOCK:-/tmp/roxira_tech_radar.lock}"
TITLE="${TECH_RADAR_TITLE:-ROXIRA Daily Technology Scout}"

# موضوعات پیش‌فرض پایش روزانه (قابل بازنویسی با TECH_RADAR_TOPICS جداکنندهٔ نویلاین)
if [[ -n "${TECH_RADAR_TOPICS:-}" ]]; then
    mapfile -t TOPICS <<< "${TECH_RADAR_TOPICS}"
else
    TOPICS=(
        "latest 2026 open-source AI agent frameworks and fast speech-to-text models"
        "latest 2026 RAG methods and vector database advancements"
        "latest 2026 NestJS ecosystem and enterprise backend architecture"
        "latest 2026 Next.js features and modern frontend rendering"
        "latest 2026 database engines, PostgreSQL performance and storage"
    )
fi

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

# ------------------------------------------------------------------------------
# جلوگیری از اجرای هم‌زمان
# ------------------------------------------------------------------------------
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    log "another tech scout run is already in progress; exiting."
    exit 0
fi

cd "${PROJECT_ROOT}"
export PYTHONPATH="${PROJECT_ROOT}:${PYTHONPATH:-}"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tech_radar.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "starting daily tech scout (${#TOPICS[@]} topics)"

index=0
for topic in "${TOPICS[@]}"; do
    [[ -z "${topic// }" ]] && continue
    index=$((index + 1))
    slug="$(echo "${topic}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | cut -c1-60)"
    out_file="${TMP_DIR}/$(printf '%02d' "${index}")_${slug}.json"
    log "scouting topic ${index}/${#TOPICS[@]}: ${topic}"
    if ! "${PYTHON_BIN}" -m src.automation.tech_radar \
        --topic "${topic}" --deep --no-save --json > "${out_file}"; then
        log "WARNING: scouting failed for topic: ${topic}"
        rm -f "${out_file}"
    fi
done

if ! ls "${TMP_DIR}"/*.json >/dev/null 2>&1; then
    log "ERROR: no reports were generated; aborting digest."
    exit 1
fi

log "merging reports into consolidated digest"
"${PYTHON_BIN}" -m src.automation.tech_radar \
    --merge-dir "${TMP_DIR}" --title "${TITLE}"

log "daily tech scout completed successfully"
