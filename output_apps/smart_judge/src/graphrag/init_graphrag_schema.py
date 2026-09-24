from __future__ import annotations

import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_graph_schema():
    print("=== INITIALIZING LEGAL & FINANCIAL KNOWLEDGE GRAPH SCHEMA ===")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # ۱. جدول نودهای گراف (قوانین، مواد، آرای وحدت رویه، نهادهای مالی)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_nodes (
                    node_id VARCHAR(64) PRIMARY KEY,
                    node_type VARCHAR(32) NOT NULL, -- STATUTE, ARTICLE, PRECEDENT, LEGAL_CONCEPT, FINANCIAL_RULE
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(64) NOT NULL,  -- CIVIL, COMMERCIAL, CRIMINAL, TAX, PROCEDURE
                    content TEXT NOT NULL,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # ۲. جدول یال‌ها و روابط بین نودها (ارجاع، تخصیص، نسخ، وحدت رویه حاکم)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_edges (
                    id SERIAL PRIMARY KEY,
                    source_node_id VARCHAR(64) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                    target_node_id VARCHAR(64) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                    relation_type VARCHAR(32) NOT NULL, -- REFERENCES, MODIFIES, GOVERNED_BY_PRECEDENT, EXCEPTED_BY, SANCTIONS
                    weight NUMERIC(3, 2) DEFAULT 1.0,
                    description VARCHAR(255),
                    UNIQUE(source_node_id, target_node_id, relation_type)
                );
            """)

            # ایندکس‌های پیمایش فوق‌سریع
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
                CREATE INDEX IF NOT EXISTS idx_graph_nodes_cat ON graph_nodes(category);
                CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(source_node_id);
                CREATE INDEX IF NOT EXISTS idx_graph_edges_tgt ON graph_edges(target_node_id);
            """)
            conn.commit()
            
    print("✅ GRAPH_SCHEMA_INITIALIZED=PASS")

if __name__ == "__main__":
    init_graph_schema()
