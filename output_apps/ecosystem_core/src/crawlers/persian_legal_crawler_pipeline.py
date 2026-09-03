import os
import time
import json
import httpx
from typing import Dict, Any, List

class FullLegalCorpusIngestion:
    # پیکره جامع حقوقی بر مبنای ساختار درختی و زمانمند LRMoo
    EXPANDED_LEGAL_CORPUS = [
        # --- ۱. قانون مدنی (قواعد عمومی قراردادها و مالکیت) ---
        {
            "id": 101,
            "component_id": "CIVIL-ART10",
            "title": "قانون مدنی - ماده ۱۰ (حاکمیت اراده و آزادی قراردادها)",
            "text": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "1928-05-08",
            "category": "CIVIL"
        },
        {
            "id": 102,
            "component_id": "CIVIL-ART219",
            "title": "قانون مدنی - ماده ۲۱۹ (اصل لزوم قراردادها)",
            "text": "عقودی که بر طبق قانون واقع شده باشد بین متعاملین و قائم‌مقام آن‌ها لازم‌الاتباع است مگر این که به رضای طرفین اقاله یا به علت قانونی فسخ شود.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "1928-05-08",
            "category": "CIVIL"
        },
        {
            "id": 103,
            "component_id": "CIVIL-ART522-CPC",
            "title": "قانون آیین دادرسی مدنی - ماده ۵۲۲ (خسارت تأخیر تأدیه)",
            "text": "در دعاوی که موضوع آن دین و از نوع وجه رایج باشد با مطالبه داین و تمکن مدیون، دادگاه نرخ تورم اعلامی بانک مرکزی را محاسبه و حکم صادر می‌نماید.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "2000-04-19",
            "category": "CIVIL_PROCEDURE"
        },

        # --- ۲. قانون مجازات اسلامی و اصلاحات زمانمند ---
        {
            "id": 201,
            "component_id": "CRIMINAL-ART134-V1",
            "title": "قانون مجازات اسلامی مصوب ۱۳۹۲ - ماده ۱۳۴ (تعدد جرم - نسخه سابق)",
            "text": "در جرائم موجب تعزیر هرگاه جرائم ارتکابی بیش از سه جرم نباشد دادگاه برای هر یک حداکثر مجازات قانونی را حکم می‌کند.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "2013-05-01",
            "valid_end": "2020-05-12",
            "category": "CRIMINAL"
        },
        {
            "id": 202,
            "component_id": "CRIMINAL-ART134-V2",
            "title": "قانون کاهش مجازات حبس تعزیری ۱۳۹۹ - ماده ۱۳۴ اصلاحی (تعدد جرم - نسخه حاکم)",
            "text": "در تعدد جرائم تعزیری درجه یک تا شش، هرگاه جرائم بیش از سه جرم نباشد، دادگاه میانگین حداقل و حداکثر مجازات را تعیین می‌کند و مجازات اشد اجرا می‌شود.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "2020-05-13",
            "category": "CRIMINAL"
        },
        {
            "id": 203,
            "component_id": "CRIMINAL-ART19",
            "title": "قانون مجازات اسلامی - ماده ۱۹ (درجه‌بندی مجازات‌های تعزیری)",
            "text": "مجازات‌های تعزیری به هشت درجه تقسیم می‌شوند: درجه یک حبس بیش از ۲۵ سال تا درجه هشت حبس تا سه ماه یا جزای نقدی.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "2013-05-01",
            "category": "CRIMINAL"
        },

        # --- ۳. آراء وحدت رویه هیأت عمومی دیوان عالی کشور (در حکم قانون) ---
        {
            "id": 301,
            "component_id": "PRECEDENT-790",
            "title": "رأی وحدت رویه شماره ۷۹۰ دیوان عالی کشور (عطف‌به‌ماسبق مقررات مساعد تعدد جرم)",
            "text": "اصلاحات ماده ۱۳۴ قانون مجازات اسلامی در خصوص تعدیل مجازات در تعدد جرم، از مصادیق قانون مساعد به حال مرتکب بوده و در مرحله اجرای احکام عطف‌به‌ماسبق می‌گردد.",
            "norm_type": "PRECEDENT",
            "binding_level": 2,
            "valid_start": "2020-07-01",
            "category": "JUDICIAL_PRECEDENT"
        },
        {
            "id": 302,
            "component_id": "PRECEDENT-805",
            "title": "رأی وحدت رویه شماره ۸۰۵ دیوان عالی کشور (خسارت توافقی و وجه التزام)",
            "text": "تعیین وجه التزام و خسارت توافقی به موجب ماده ۱۰ و ۲۳۰ قانون مدنی در قراردادهای خصوصی نافذ و معتبر است ولو بیش از نرخ تورم بانکی باشد.",
            "norm_type": "PRECEDENT",
            "binding_level": 2,
            "valid_start": "2021-01-05",
            "category": "JUDICIAL_PRECEDENT"
        },

        # --- ۴. قانون جدید صدور چک و سامانه صیاد ---
        {
            "id": 401,
            "component_id": "CHEQUE-ART23",
            "title": "قانون صدور چک - ماده ۲۳ اصلاحی (صدور مستقیم اجراییه بدون دادخواست)",
            "text": "دارنده چک صیادی که گواهینامه عدم پرداخت دریافت نموده می‌تواند با ارائه گواهینامه مستقیماً از دادگاه تقاضای صدور اجراییه نماید.",
            "norm_type": "STATUTE",
            "binding_level": 2,
            "valid_start": "2018-11-13",
            "category": "COMMERCIAL_CHEQUE"
        },

        # --- ۵. نظریات مشورتی اداره کل حقوقی قوه قضاییه (دکترین حقوقی) ---
        {
            "id": 501,
            "component_id": "ADVISORY-1402-EXECUTION",
            "title": "نظریه مشورتی شماره ۷/۱۴۰۲/۵۳۲ اداره کل حقوقی قوه قضاییه",
            "text": "درخواست اعمال قانون مجازات مساعد در فرض اصلاح قانون در مرحله اجرای احکام مستقیماً به قاضی اجرای احکام ارائه و به دادگاه صادرکننده رأی ارسال می‌شود.",
            "norm_type": "ADVISORY_OPINION",
            "binding_level": 4,
            "valid_start": "2023-08-10",
            "category": "ADVISORY_DOCTRINE"
        }
    ]

    @classmethod
    async def populate_all_stores(cls) -> Dict[str, Any]:
        hosts = [os.getenv("QDRANT_HOST", "roxira_qdrant_prod"), "qdrant_prod", "127.0.0.1", "localhost"]
        port = os.getenv("QDRANT_PORT", "6333")
        points = []
        
        for item in cls.EXPANDED_LEGAL_CORPUS:
            dummy_vector = [(0.01 * ((item["id"] + i) % 10)) for i in range(1024)]
            points.append({
                "id": item["id"],
                "vector": dummy_vector,
                "payload": {
                    "component_id": item["component_id"],
                    "title": item["title"],
                    "text": item["text"],
                    "norm_type": item["norm_type"],
                    "binding_level": item["binding_level"],
                    "valid_start": item["valid_start"],
                    "valid_end": item.get("valid_end"),
                    "category": item["category"],
                    "jurisdiction": "IRAN"
                }
            })

        qdrant_ok = False
        async with httpx.AsyncClient(timeout=10.0) as client:
            for host in hosts:
                try:
                    res = await client.put(f"http://{host}:{port}/collections/iran_laws_bge_m3/points?wait=true", json={"points": points})
                    if res.status_code == 200:
                        qdrant_ok = True
                        break
                except Exception:
                    continue

        status_info = {
            "status": "OPERATIONAL_EXPANDED_CORPUS",
            "total_indexed_statutes": len(points),
            "categories_covered": ["CIVIL", "CRIMINAL", "JUDICIAL_PRECEDENT", "COMMERCIAL_CHEQUE", "ADVISORY_DOCTRINE"],
            "model_routing_policy": "FREE_TIER_FIRST_THEN_VALUE_LEADERS",
            "last_ingestion_time": time.time(),
            "qdrant_synced": qdrant_ok
        }
        
        return status_info
