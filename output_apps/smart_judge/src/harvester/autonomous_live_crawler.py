"""
ROXIRA AUTONOMOUS LIVE LEGAL CRAWLER & SYNCHRONIZER
خزش، ساختاردهی و به‌روزرسانی خودکار قوانین و آرای وحدت رویه
"""
import sys
import json
import pathlib
import datetime
from typing import List, Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from output_apps.smart_judge.src.harvester.iran_legal_autonomous_harvester import AutonomousLegalHarvesterEngine

class AutonomousLiveLegalCrawler:
    @staticmethod
    def run_live_crawl_and_sync() -> Dict[str, Any]:
        """اجرای چرخه خزش، اعتبارسنجی قوانین و تزریق به پایگاه دانش گرافی"""
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        sync_res = AutonomousLegalHarvesterEngine.harvest_and_ingest_all()
        
        return {
            "crawler_status": "CRAWL_AND_SYNC_COMPLETED",
            "executed_at": timestamp,
            "ingested_nodes": sync_res.get("nodes_ingested", 0),
            "linked_edges": sync_res.get("edges_linked", 0),
            "monitored_sources": [
                "سامانه ملی قوانین و مقررات (dotic.ir)",
                "پایگاه قوانین مرکز پژوهش‌های مجلس (rc.majlis.ir)",
                "روزنامه رسمی کشور (rrk.ir)",
                "هیات عمومی دیوان عالی کشور"
            ]
        }

if __name__ == "__main__":
    res = AutonomousLiveLegalCrawler.run_live_crawl_and_sync()
    print("✅ Autonomous Legal Crawler Executed | Synced Nodes:", res["ingested_nodes"])
