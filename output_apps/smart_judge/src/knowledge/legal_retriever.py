from __future__ import annotations

import psycopg
from typing import List, Dict
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def search_relevant_statutes(query_terms: List[str], limit: int = 5) -> List[Dict[str, str]]:
    """Retrieves relevant legal statutes and precedents from PostgreSQL database."""
    results = []
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # جستجوی ترکیبی بر اساس کلمات کلیدی در عنوان قانون، موضوع و متن
            sql = """
                SELECT category, law_title, article_number, subject, content
                FROM legal_statutes
                WHERE """ + " OR ".join(["subject ILIKE %s OR content ILIKE %s OR law_title ILIKE %s" for _ in query_terms]) + f" LIMIT {limit};"
            
            params = []
            for term in query_terms:
                wildcard = f"%{term}%"
                params.extend([wildcard, wildcard, wildcard])
            
            cur.execute(sql, params)
            rows = cur.fetchall()
            for r in rows:
                results.append({
                    "category": r[0],
                    "law_title": r[1],
                    "article_number": r[2],
                    "subject": r[3],
                    "content": r[4]
                })
    return results

if __name__ == "__main__":
    test_terms = ["خسارت", "تخلف", "قرارداد", "دادخواست"]
    matched = search_relevant_statutes(test_terms)
    print(f"MATCHED_STATUTES_COUNT: {len(matched)}")
    for m in matched:
        print(f" -> [{m['category']}] {m['law_title']} - {m['article_number']} ({m['subject']})")
