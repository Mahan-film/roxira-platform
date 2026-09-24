from __future__ import annotations

import os
import json
import psycopg
from typing import List, Dict, Any
from src.roxira_config import postgres_dsn

def get_db_url() -> str:
    pg_host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    pg_port = os.getenv("POSTGRES_PORT", "5434" if pg_host in ("127.0.0.1", "localhost") else "5432")
    return os.getenv("DATABASE_URL") or postgres_dsn(host=pg_host, port=pg_port)

class LegalGraphRAGEngine:
    """Multi-Hop Hierarchical GraphRAG Engine for Iranian Law & Jurisprudence."""

    IN_MEMORY_NODES = [
        {"node_id": "CIVIL-ART-10", "node_type": "ARTICLE", "title": "ماده ۱۰ قانون مدنی", "content": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است."},
        {"node_id": "CIVIL-ART-230", "node_type": "ARTICLE", "title": "ماده ۲۳۰ قانون مدنی", "content": "اگر در ضمن معامله شرط وجه التزام شده باشد حاکم نمی‌تواند متخلف را به بیشتر یا کمتر محکوم کند."},
        {"node_id": "CHECK-ART-23", "node_type": "ARTICLE", "title": "ماده ۲۳ قانون صدور چک", "content": "امکان صدور اجرائیه مستقیم بدون رسیدگی ماهوی توسط دادگاه با گواهینامه عدم پرداخت."},
        {"node_id": "PRECEDENT-805", "node_type": "PRECEDENT", "title": "رای وحدت رویه ۸۰۵ دیوان عالی", "content": "تعیین وجه التزام قراردادی مازاد بر نرخ تورم بانک مرکزی معتبر و لازم‌الاتباع است."},
        {"node_id": "PROC-ART-522", "node_type": "ARTICLE", "title": "ماده ۵۲۲ قانون آیین دادرسی مدنی", "content": "محاسبه خسارت تاخیر تادیه بر مبنای تغییر شاخص سالانه بهای کالاها و خدمات بانک مرکزی."}
    ]

    @classmethod
    def query_graph_context(cls, query_text: str, max_depth: int = 2) -> Dict[str, Any]:
        matched_nodes: List[Dict[str, Any]] = []
        traversed_edges: List[Dict[str, Any]] = []
        db_url = get_db_url()

        try:
            with psycopg.connect(db_url, connect_timeout=3) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT node_id, node_type, title, category, content, metadata
                        FROM graph_nodes
                        WHERE content ILIKE %s OR title ILIKE %s OR metadata::text ILIKE %s
                        LIMIT 5;
                    """, (f"%{query_text}%", f"%{query_text}%", f"%{query_text}%"))
                    
                    initial_nodes = cur.fetchall()
                    if not initial_nodes:
                        words = [w for w in query_text.split() if len(w) > 3]
                        for w in words:
                            cur.execute("SELECT node_id, node_type, title, category, content, metadata FROM graph_nodes WHERE content ILIKE %s LIMIT 3;", (f"%{w}%",))
                            initial_nodes.extend(cur.fetchall())

                    node_ids = list({row[0] for row in initial_nodes})
                    for row in initial_nodes:
                        matched_nodes.append({
                            "node_id": row[0], "node_type": row, "title": row,
                            "category": row, "content": row, "metadata": row
                        })

                    if node_ids:
                        cur.execute("""
                            WITH RECURSIVE graph_path AS (
                                SELECT source_node_id, target_node_id, relation_type, weight, description, 1 as depth
                                FROM graph_edges
                                WHERE source_node_id = ANY(%s) OR target_node_id = ANY(%s)
                                UNION
                                SELECT e.source_node_id, e.target_node_id, e.relation_type, e.weight, e.description, gp.depth + 1
                                FROM graph_edges e
                                JOIN graph_path gp ON (e.source_node_id = gp.target_node_id OR e.target_node_id = gp.source_node_id)
                                WHERE gp.depth < %s
                            )
                            SELECT DISTINCT source_node_id, target_node_id, relation_type, weight, description
                            FROM graph_path;
                        """, (node_ids, node_ids, max_depth))
                        
                        edges_raw = cur.fetchall()
                        connected_node_ids = set()
                        for e in edges_raw:
                            traversed_edges.append({
                                "source": e[0], "target": e, "relation": e,
                                "weight": float(e), "description": e
                            })
                            connected_node_ids.add(e[0])
                            connected_node_ids.add(e)

                        additional_ids = list(connected_node_ids - set(node_ids))
                        if additional_ids:
                            cur.execute("""
                                SELECT node_id, node_type, title, category, content, metadata
                                FROM graph_nodes
                                WHERE node_id = ANY(%s);
                            """, (additional_ids,))
                            for row in cur.fetchall():
                                matched_nodes.append({
                                    "node_id": row[0], "node_type": row, "title": row,
                                    "category": row, "content": row, "metadata": row,
                                    "discovered_via_graph": True
                                })
        except Exception:
            for n in cls.IN_MEMORY_NODES:
                if any(w in n["content"] or w in n["title"] for w in query_text.split()):
                    matched_nodes.append(n)
            if not matched_nodes:
                matched_nodes = cls.IN_MEMORY_NODES[:2]

        context_blocks = []
        for n in matched_nodes:
            t = str(n.get("title", "قانون"))
            c = str(n.get("content", ""))
            prefix = "⚡ [رای وحدت رویه حاکم: " + t + "]" if n.get("node_type") == "PRECEDENT" else "📜 [" + t + "]"
            context_blocks.append(prefix + "\nمتن: " + c)

        relations_blocks = []
        for e in traversed_edges:
            s_node = str(e.get("source", ""))
            r_type = str(e.get("relation", ""))
            r_desc = str(e.get("description", ""))
            t_node = str(e.get("target", ""))
            relations_blocks.append("• " + s_node + " --(" + r_type + ": " + r_desc + ")--> " + t_node)

        graph_context_text = "### مستندات استخراج‌شده از گراف دانش حقوقی:\n" + "\n\n".join(context_blocks)
        if relations_blocks:
            graph_context_text += "\n\n### روابط و ارجاعات متقابل حاکم بین قوانین:\n" + "\n".join(relations_blocks)

        return {
            "query": query_text,
            "total_nodes_retrieved": len(matched_nodes),
            "total_edges_traversed": len(traversed_edges),
            "synthesized_graph_context": graph_context_text,
            "nodes": matched_nodes,
            "edges": traversed_edges
        }

if __name__ == "__main__":
    engine = LegalGraphRAGEngine()
    res = engine.query_graph_context("مطالبه وجه التزام قراردادی روزانه و خسارت تاخیر")
    print("Nodes Found:", res["total_nodes_retrieved"])
