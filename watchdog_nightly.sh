#!/bin/bash
while true; do
    TIME=$(date '+%Y-%m-%d %H:%M:%S')
    # بررسی سلامت پایتون
    if ! curl -s http://127.0.0.1:8000/api/v1/apps/judge/health | grep -q '"status":"ok"'; then
        echo "[$TIME] Uvicorn unresponsive. Restarting enterprise_app..." >> /opt/roxira_platform/data/watchdog.log
        docker compose -f /opt/roxira_platform/docker-compose.prod.yml restart enterprise_app
    fi
    # بررسی سلامت Qdrant
    if ! curl -s http://127.0.0.1:6333/collections/iran_laws_bge_m3 | grep -q '"status":"ok"'; then
        echo "[$TIME] Qdrant unresponsive. Restarting qdrant..." >> /opt/roxira_platform/data/watchdog.log
        docker compose -f /opt/roxira_platform/docker-compose.prod.yml restart roxira_qdrant_prod
    fi
    sleep 30
done
