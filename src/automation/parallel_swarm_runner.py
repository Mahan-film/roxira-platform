#!/usr/bin/env python3
import asyncio
import pathlib
import sys
import time

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.automation.git_worktree_manager import GitWorktreeManager

async def run_worker(task_id: str, task_name: str, command: str):
    t0 = time.time()
    wm = GitWorktreeManager()
    print(f"🚀 [AGENT: {task_id}] ایجاد شاخه کاری ایزوله برای: {task_name}")
    session = wm.create(task_id)
    if session.get("status") == "ERROR":
        return {"agent": task_id, "task": task_name, "status": "FAILED", "error": session.get("error")}

    print(f"⚙️  [AGENT: {task_id}] در حال پردازش موازی...")
    res = wm.run(task_id, ["bash", "-c", command])
    elapsed = round(time.time() - t0, 2)

    wm.remove(task_id, delete_branch=True)
    status = "SUCCESS" if res.get("ok") else "FAILED"
    print(f"✅ [AGENT: {task_id}] پایان تسک ({status}) در {elapsed} ثانیه")
    return {"agent": task_id, "task": task_name, "status": status, "time_sec": elapsed}

async def main():
    print("="*70)
    print("🐝 آغاز اجرای موازی هم‌زمان ازدحام ۵ ایجنتی (5-Agent Parallel Swarm)")
    print("="*70)
    
    tasks = [
        run_worker("agent-1-audit", "ممیزی موتورهای هوش مصنوعی", "python3 src/automation/test_factory_engines.py"),
        run_worker("agent-2-lint", "بررسی استایل و تایپ‌های فرانت‌اند", "npm --prefix output_apps/enterprise_hub/frontend run lint || true"),
        run_worker("agent-3-radar", "بررسی سلامت کاوشگر وب و رادار فناوری", "python3 src/automation/tech_radar.py --topic 'microvm firecracker e2b testing'"),
        run_worker("agent-4-db", "بررسی صحت کوئری‌های دیتابیس", "docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c 'SELECT count(*) FROM users;'"),
        run_worker("agent-5-health", "پایش کانتینرهای زنده و کش ردیس", "docker exec roxira_redis_prod redis-cli ping"),
    ]
    
    results = await asyncio.gather(*tasks)
    print("\n" + "="*70)
    print("📊 گزارش وضعیت اجرای موازی ۵ ایجنت:")
    print("="*70)
    for r in results:
        badge = "🟢" if r["status"] == "SUCCESS" else "🔴"
        print(f"{badge} {r['agent']:<16} | {r['task']:<35} | {r['status']:<8} | زمان: {r.get('time_sec', 0)}s")
    print("="*70)

if __name__ == "__main__":
    asyncio.run(main())
