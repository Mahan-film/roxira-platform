import asyncio
import os
import sys

# افزودن مسیر به ماژول‌های سیستم
sys.path.insert(0, "/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers")
from roxira_factory_core import RoxiraSoftwareFactory

MODULES_TO_BUILD = [
    {
        "name": "WarehouseInventory",
        "category": "ERP",
        "features": ["StockTracking", "BatchNumbering", "MultiWarehouse", "BarcodeScanner"]
    },
    {
        "name": "AtomicCRM",
        "category": "CRM",
        "features": ["LeadManagement", "PipelineTracking", "InteractionLog", "TaskAutomation"]
    },
    {
        "name": "DoclingParser",
        "category": "DocumentProcessing",
        "features": ["PDFTableExtraction", "InvoiceZUGFeRDValidation", "MarkdownConversion"]
    },
    {
        "name": "ScraplingWebAgent",
        "category": "WebIntelligence",
        "features": ["AntiBotBypass", "CamoufoxStealth", "CompetitorPriceMonitoring"]
    }
]

async def main():
    print("🏭 آغاز فرآیند خط تولید ماژول‌های سازمانی روکسیرا (Roxira OS)...\n")
    for mod in MODULES_TO_BUILD:
        print(f"⚙️ در حال تولید ماژول [{mod['name']}] در دسته {mod['category']}...")
        res = await RoxiraSoftwareFactory.synthesize_and_save_module(
            module_name=mod["name"],
            category=mod["category"],
            features=mod["features"]
        )
        if res.get("status") == "success":
            print(f"✅ با موفقیت ذخیره شد: {res['saved_path']} (مدل: {res.get('model_used')})\n")
        else:
            print(f"⚠️ خطا در تولید {mod['name']}: {res.get('details')}\n")

if __name__ == "__main__":
    asyncio.run(main())
