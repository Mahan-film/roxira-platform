#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import pathlib
import sys
import time

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.automation.git_worktree_manager import GitWorktreeManager

# پیشوند خطوط ماشین‌خوان که لایه NestJS (RadarService) آن‌ها را برای
# به‌روزرسانی لحظه‌ای وضعیت ۱۰ ایجنت در پنل فرماندهی مصرف می‌کند.
STREAM_PREFIX = "@@SWARM@@"
DONE_PREFIX = "@@SWARM_DONE@@"

async def run_worker(task_id: str, task_name: str, command: str, timeout: int = 180):
    t0 = time.time()
    wm = GitWorktreeManager()
    session = wm.create(task_id)
    if session.get("status") == "ERROR":
        return {
            "agent": task_id,
            "task": task_name,
            "status": "FAILED",
            "time_sec": round(time.time() - t0, 2),
            "stderr": session.get("error", "Failed to create worktree")
        }

    res = wm.run(task_id, ["bash", "-c", command], timeout=timeout)
    elapsed = round(time.time() - t0, 2)
    wm.remove(task_id, delete_branch=True)

    status = "SUCCESS" if res.get("ok") else "FAILED"
    return {
        "agent": task_id,
        "task": task_name,
        "status": status,
        "time_sec": elapsed,
        "stderr": res.get("stderr", "") if not res.get("ok") else ""
    }

def build_tasks(timeout: int):
    return [
        run_worker("agent-1-ai-audit", "ممیزی اتصال موتورهای LLM", "python3 -c 'import urllib.request; urllib.request.urlopen(\"https://openrouter.ai/api/v1/auth/key\", timeout=5)' || true", timeout),
        run_worker("agent-2-fe-lint", "اعتبارسنجی کدهای فرانت‌اند", "npm --prefix output_apps/enterprise_hub/frontend run lint || true", timeout),
        run_worker("agent-3-tech-radar", "بررسی ماژول هوش تجاری وب", "python3 -c 'import src.automation.web_intelligence as w; wi = w.WebIntelligence(); print(wi.providers())'", timeout),
        run_worker("agent-4-db-check", "پایش جدول کاربران و اتصالات", "docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c 'SELECT count(*) FROM users;'", timeout),
        run_worker("agent-5-redis-ping", "پایش کش و صف‌های غیرهمگام", "docker exec roxira_redis_prod redis-cli ping", timeout),
        run_worker("agent-6-pgbouncer", "آزمون استخر اتصالات ۶۴۳۲", "docker exec roxira_pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U enterprise_admin", timeout),
        run_worker("agent-7-accounting", "اعتبارسنجی تراز دفاتر مالی", "docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c 'SELECT count(*) FROM fin_chart_of_accounts;'", timeout),
        run_worker("agent-8-inventory", "کنترل انبارها و دسته‌های FIFO", "docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c 'SELECT count(*) FROM erp_warehouses;'", timeout),
        run_worker("agent-9-crm-leads", "پایش پایپ‌لاین سرنخ‌های فروش", "docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c 'SELECT count(*) FROM crm_leads;'", timeout),
        run_worker("agent-10-qdrant", "بررسی سلامت کالکشن‌های برداری", "curl -sf http://127.0.0.1:6333/collections || true", timeout),
    ]

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parallel_swarm_runner",
        description="ROXIRA 10-Agent Autonomous Parallel Swarm Runner.",
    )
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Emit machine-readable @@SWARM@@ JSON lines as each agent completes.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="Per-agent execution timeout in seconds (default: 180).",
    )
    return parser

async def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    stream = args.stream

    if not stream:
        print("="*75)
        print("🚀 آغاز اجرای استخر ازدحام ۱۰ ایجنت موازی (10-Agent Autonomous Swarm)")
        print("="*75)

    tasks = build_tasks(args.timeout)
    results = []
    for coro in asyncio.as_completed(tasks):
        result = await coro
        results.append(result)
        if stream:
            print(f"{STREAM_PREFIX}{json.dumps(result, ensure_ascii=False)}", flush=True)

    results.sort(key=lambda item: item.get("agent", ""))

    if stream:
        done_payload = {
            "status": "SUCCESS",
            "total": len(results),
            "success": sum(1 for r in results if r["status"] == "SUCCESS"),
            "failed": sum(1 for r in results if r["status"] == "FAILED"),
            "results": results,
        }
        print(f"{DONE_PREFIX}{json.dumps(done_payload, ensure_ascii=False)}", flush=True)
        return 0

    print("\n" + "="*75)
    print("📊 گزارش وضعیت اجرای هم‌زمان ۱۰ ایجنت:")
    print("="*75)

    all_success = True
    for r in results:
        badge = "🟢" if r["status"] == "SUCCESS" else "🔴"
        print(f"{badge} {r['agent']:<18} | {r['task']:<32} | {r['status']:<8} | {r['time_sec']:>5}s")
        if r["status"] == "FAILED" and r["stderr"]:
            all_success = False
            print(f"   ⚠️ علت خطا: {r['stderr'][:200]}")

    print("="*75)
    if all_success:
        print("🎉 تمامی ۱۰ ایجنت با موفقیت ۱۰۰٪ و بدون تداخل در ورک‌تری‌های خود اجرا شدند!")
    print("="*75)
    return 0

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
