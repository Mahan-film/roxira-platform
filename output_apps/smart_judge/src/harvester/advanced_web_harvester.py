"""
ROXIRA ADVANCED STATUTES & PRECEDENTS WEB HARVESTER
خزشگر و تبدیل‌کننده خودکار متون قوانین به فرمت‌های استاندارد Markdown و JSON
"""
import re
import pathlib
from typing import List, Dict, Any

class AdvancedStatutesHarvester:
    @staticmethod
    def parse_raw_legal_text_to_nodes(raw_text: str, statute_category: str = "CIVIL") -> List[Dict[str, Any]]:
        """
        تجزیه خودکار متون خام قوانین و استخراج تک‌تک مواد به همراه کلمات کلیدی
        """
        # الگوی استاندارد تشخیص ماده‌ها در قوانین ایران
        pattern = r"(ماده\s+(\d+)[\s\-\:\.\–]+(.*?))(?=(ماده\s+\d+)|$)"
        matches = re.findall(pattern, raw_text, flags=re.DOTALL)
        
        extracted_nodes = []
        for full_match, art_num, art_body, _ in matches:
            clean_body = re.sub(r"\s+", " ", art_body).strip()
            node_id = f"{statute_category}-ART-{art_num}"
            title = f"ماده {art_num} قانون {statute_category}"
            
            # استخراج خودکار کلمات کلیدی حقوقی
            keywords = [w for w in clean_body.split() if len(w) > 4][:5]
            
            extracted_nodes.append({
                "node_id": node_id,
                "node_type": "ARTICLE",
                "title": title,
                "category": statute_category,
                "content": clean_body,
                "metadata": {"keywords": keywords, "article_number": int(art_num)}
            })
            
        return extracted_nodes

if __name__ == "__main__":
    sample_law = """
    ماده ۱۰ - قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.
    ماده ۲۱۹ - عقودی که بر طبق قانون واقع شده باشد بین متعاملین و قائم‌مقام آنها لازم‌الاتباع است.
    ماده ۲۳۰ - اگر در ضمن معامله شرط شده باشد که متخلف مبلغی به عنوان خسارت تادیه نماید حاکم نمی‌تواند او را به بیشتر یا کمتر محکوم کند.
    """
    nodes = AdvancedStatutesHarvester.parse_raw_legal_text_to_nodes(sample_law, "CIVIL")
    print("✅ تست خزشگر و پارسر خودکار متون حقوقی:")
    print(f"تعداد مواد استخراج‌شده: {len(nodes)}")
    for n in nodes:
        print(f"  ├─ {n['title']}: {n['content'][:50]}...")
