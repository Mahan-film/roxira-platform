"""
ROXIRA 24/7 AUTONOMOUS LEGAL CRAWLER & SCHEMA INITIALIZER
"""
import os
import sys
import time
import json
import psycopg
import pathlib
import datetime
import threading
from typing import Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from output_apps.smart_judge.src.harvester.iran_legal_autonomous_harvester import AutonomousLegalHarvesterEngine
from src.roxira_config import postgres_dsn

def get_db_url() -> str:
    pg_host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    pg_port = os.getenv("POSTGRES_PORT", "5434" if pg_host in ("127.0.0.1", "localhost") else "5432")
    return os.getenv("DATABASE_URL") or postgres_dsn(host=pg_host, port=pg_port)

class ContinuousLegalCrawlerDaemon:
    STATUS_FILE = pathlib.Path("crawler_live_status.json")
    _is_running = False
    _total_ingested = 0
    _current_task = "در حال راه‌اندازی اولیه"

    @classmethod
    def _init_db_schema(cls, conn):
        """ساخت خودکار جداول و ایندکس‌های گرافی در صورت عدم وجود"""
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_nodes (
                    node_id VARCHAR(128) PRIMARY KEY,
                    node_type VARCHAR(64) DEFAULT 'ARTICLE',
                    title VARCHAR(512) NOT NULL,
                    category VARCHAR(128),
                    content TEXT NOT NULL,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS graph_edges (
                    source_node_id VARCHAR(128) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                    target_node_id VARCHAR(128) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                    relation_type VARCHAR(64) NOT NULL,
                    weight FLOAT DEFAULT 1.0,
                    description TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY (source_node_id, target_node_id, relation_type)
                );

                CREATE INDEX IF NOT EXISTS idx_graph_nodes_category ON graph_nodes(category);
                CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
                CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
            """)
            conn.commit()

    @classmethod
    def start_background_crawler(cls):
        if cls._is_running:
            return
        cls._is_running = True
        thread = threading.Thread(target=cls._crawler_loop, daemon=True)
        thread.start()

    @classmethod
    def _crawler_loop(cls):
        while cls._is_running:
            try:
                db_url = get_db_url()
                with psycopg.connect(db_url, connect_timeout=5) as conn:
                    # ۱. اطمینان از وجود جداول در دیتابیس
                    cls._init_db_schema(conn)
                    
                    # ۲. اجرای خزش و تزریق نودها
                    cls._current_task = "خزش، استخراج و تزریق نودهای قوانین"
                    AutonomousLegalHarvesterEngine.harvest_and_ingest_all()
                    
                    # ۳. به‌روزرسانی آمار نودها
                    with conn.cursor() as cur:
                        cur.execute("SELECT count(*) FROM graph_nodes;")
                        cls._total_ingested = cur.fetchone()[0]

                status_payload = {
                    "daemon_status": "RUNNING_24_7",
                    "total_nodes_in_graph": cls._total_ingested,
                    "current_operation": "پایش ۲۴ ساعته مراجع و آماده دریافت استعلامات",
                    "last_heartbeat": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
                cls.STATUS_FILE.write_text(json.dumps(status_payload, ensure_ascii=False, indent=2), encoding="utf-8")
                
            except Exception as e:
                cls._current_task = f"تلاش مجدد: {str(e)[:50]}"
            
            time.sleep(30)

    @classmethod
    def get_live_metrics(cls) -> Dict[str, Any]:
        if cls.STATUS_FILE.exists():
            try:
                return json.loads(cls.STATUS_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {
            "daemon_status": "INITIALIZING",
            "total_nodes_in_graph": cls._total_ingested,
            "current_operation": cls._current_task
        }

if __name__ == "__main__":
    ContinuousLegalCrawlerDaemon.start_background_crawler()
    time.sleep(2)
    print(ContinuousLegalCrawlerDaemon.get_live_metrics())
