#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

def normalize_persian(text: str) -> str:
    chars = {"ي": "ی", "ك": "ک", "ة": "ه", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴", "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹", "٠": "۰"}
    for k, v in chars.items():
        text = text.replace(k, v)
    return " ".join(text.split())

class EkhtebarLegalCrawler:
    """خزشگر مقاوم اختبار با پشتیبانی از فید جامع و استخراج هوشمند"""
    
    PRIMARY_FEEDS = [
        "https://www.ekhtebar.com/feed/",
        "https://www.ekhtebar.com/comments/feed/"
    ]

    def fetch_latest_updates(self, limit: int = 6):
        print("="*70)
        print("📡 آغاز خزش هوشمند پایگاه اختبار با مکانیزم چندلایه...")
        print("="*70)
        
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
        items_processed = 0

        for feed_url in self.PRIMARY_FEEDS:
            try:
                req = urllib.request.Request(feed_url, headers=headers)
                with urllib.request.urlopen(req, timeout=12) as response:
                    xml_data = response.read()
                    root = ET.fromstring(xml_data)
                    
                    for item in root.findall(".//item")[:limit]:
                        title = item.find("title").text if item.find("title") is not None else ""
                        link = item.find("link").text if item.find("link") is not None else ""
                        desc = item.find("description").text if item.find("description") is not None else ""
                        
                        clean_title = normalize_persian(title)
                        clean_desc = normalize_persian(re.sub(r"<[^>]+>", "", desc))
                        
                        if len(clean_desc) < 20:
                            continue

                        # تشخیص شاخه قضایی
                        if any(w in clean_title for w in ["وحدت رویه", "دیوان عالی"]):
                            node_type, category = "PRECEDENT", "آرای قضایی"
                        elif any(w in clean_title for w in ["مشورتی", "اداره حقوقی"]):
                            node_type, category = "OPINION", "نظریات مشورتی"
                        else:
                            node_type, category = "CIRCULAR", "بخشنامه‌ها و مقررات"

                        node_id = f"EKHTEBAR_{abs(hash(link)) % 1000000}"
                        meta = json.dumps({"source": "ekhtebar.com", "url": link, "title": clean_title}, ensure_ascii=False)
                        
                        sql = f"""
                        INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                        VALUES ('{node_id}', '{node_type}', '{clean_title.replace("'", "")}', '{category}', '{clean_desc.replace("'", "")}', '{meta}'::jsonb)
                        ON CONFLICT (node_id) DO UPDATE SET content = EXCLUDED.content;
                        """
                        subprocess.run(["docker", "exec", "-i", "roxira_postgres_prod", "psql", "-U", "enterprise_admin", "-d", "enterprise_db", "-c", sql], capture_output=True)
                        items_processed += 1
                        print(f"📥 [EKHTEBAR] ایندکس شد: {clean_title[:55]}...")
                        
                if items_processed > 0:
                    break
            except Exception as e:
                print(f"ℹ️ انتقال به فید جایگزین به دلیل: {e}")

        print(f"\n✅ مجموع {items_processed} سند حقوقی معتبر وارد گراف دانش قاضی هوشمند شد.")
        print("="*70)

if __name__ == "__main__":
    crawler = EkhtebarLegalCrawler()
    crawler.fetch_latest_updates(limit=5)
