import os
import sys
import pathlib
from typing import Dict, Any

# اضافه کردن مسیر ریشه پروژه به پایتون
CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from src.intelligence.models.smart_ai_router import SmartAIRouter

class AutonomousProductFactory:
    def __init__(self):
        self.router = SmartAIRouter()

    def generate_new_product_service(self, product_name: str, specification_prompt: str) -> Dict[str, Any]:
        system_prompt = "You are the Roxira Autonomous Software Factory Engine. Write production-ready, clean, modular Python 3.13 code for the requested product. Return only valid executable python code without markdown formatting."
        prompt = "Design and implement a complete standalone backend service for product " + product_name + ":\n" + specification_prompt
        ai_result = self.router.execute_prompt(prompt, system_prompt)
        
        product_dir = pathlib.Path("output_apps") / product_name
        product_dir.mkdir(parents=True, exist_ok=True)
        
        output_file = product_dir / "service.py"
        output_file.write_text(ai_result.get("output", "# Generated code"), encoding="utf-8")
        
        return {
            "status": "GENERATED",
            "product_name": product_name,
            "artifact_path": str(output_file),
            "model_used": ai_result.get("model_used")
        }

if __name__ == "__main__":
    print("=== تست موتور کارخانه هوش مصنوعی ROXIRA ===")
    factory = AutonomousProductFactory()
    res = factory.generate_new_product_service(
        "mini_pos",
        "یک سیستم ساده پایانه فروش با قابلیت ثبت رسید و محاسبه موجودی نقد."
    )
    print("✅ محصول جدید تولید شد:", res.get("artifact_path"), "| مدل:", res.get("model_used"))
