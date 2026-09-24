#!/usr/bin/env python3
import psycopg
import json
import os
from src.roxira_config import postgres_dsn

POSTGRES_DSN = postgres_dsn(host="roxira_postgres_prod", port=5432)
PUBLIC_DIR = "/opt/roxira_platform/output_apps/enterprise_hub/frontend/public"

try:
    with psycopg.connect(POSTGRES_DSN, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT node_id, node_type, title, category FROM graph_nodes WHERE metadata->>'status' = 'ACTIVE';")
            nodes = cur.fetchall()

    sitemap_xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sitemap_xml.append('  <url><loc>https://ghazihoushmand.ir/</loc><priority>1.0</priority><changefreq>daily</changefreq></url>')
    
    for n in nodes:
        node_id, n_type, title, cat = n[0], n[1], n[2], n[3]
        prefix = "laws" if n_type == "LAW" else "precedents"
        slug = node_id.lower().replace("_", "-")
        sitemap_xml.append(f'  <url><loc>https://ghazihoushmand.ir/{prefix}/{slug}</loc><priority>0.8</priority><changefreq>weekly</changefreq></url>')

    sitemap_xml.append('</urlset>')
    
    with open(os.path.join(PUBLIC_DIR, "sitemap_comprehensive.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(sitemap_xml))
    print(f"✅ نقشه سایت جامع شامل {len(nodes)} صفحه ایندکس‌پذیر اختصاصی در sitemap_comprehensive.xml ذخیره شد.")
except Exception as e:
    print("خطا در تولید نقشه سایت:", e)
