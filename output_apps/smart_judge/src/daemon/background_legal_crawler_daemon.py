"""
ROXIRA BACKGROUND AUTONOMOUS LEGAL CRAWLER DAEMON
دیمن پایش و به‌روزرسانی خودکار قوانین و آرای وحدت رویه در پس‌زمینه
"""
import sys
import time
import pathlib
import datetime

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from output_apps.smart_judge.src.harvester.iran_legal_autonomous_harvester import AutonomousLegalHarvesterEngine

def run_periodic_crawler_cycle(interval_seconds: int = 86400):
    print(f"[{datetime.datetime.now()}] 🔄 Autonomous Legal Crawler Daemon Started.")
    try:
        res = AutonomousLegalHarvesterEngine.harvest_and_ingest_all()
        print(f"[{datetime.datetime.now()}] ✅ Legal Graph Synced: {res.get('nodes_ingested')} Nodes, {res.get('edges_linked')} Edges.")
    except Exception as e:
        print(f"[{datetime.datetime.now()}] ❌ Daemon sync error: {e}")

if __name__ == "__main__":
    # اجرای یک چرخه کامل تست
    run_periodic_crawler_cycle(interval_seconds=10)
