#!/usr/bin/env python3
import xml.etree.ElementTree as ET
import os
import urllib.request
import json

SITEMAP_PATH = "/opt/roxira_platform/output_apps/enterprise_hub/frontend/public/sitemap_comprehensive.xml"

def dispatch_urls():
    if not os.path.exists(SITEMAP_PATH):
        print("فایل نقشه سایت یافت نشد.")
        return

    tree = ET.parse(SITEMAP_PATH)
    root = tree.getroot()
    urls = [elem.text for elem in root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    
    print(f"📊 تعداد {len(urls)} آدرس ایندکس‌پذیر جهت خزش موتورهای جستجو شناسایی شد.")
    # پینگ سرورهای نقشه سایت
    ping_targets = [
        f"https://www.google.com/ping?sitemap=https://ghazihoushmand.ir/sitemap_comprehensive.xml",
        f"https://www.bing.com/ping?sitemap=https://ghazihoushmand.ir/sitemap_comprehensive.xml"
    ]
    for p in ping_targets:
        try:
            req = urllib.request.Request(p, headers={"User-Agent": "RoxiraSEOBot"})
            with urllib.request.urlopen(req, timeout=5) as r:
                print(f"✅ ارسال نقشه سایت با موفقیت انجام شد: {p[:35]}...")
        except Exception:
            pass

if __name__ == "__main__":
    dispatch_urls()
