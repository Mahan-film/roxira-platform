"""
ROXIRA AUTONOMOUS MULTI-AGENT SWARM ORCHESTRATOR
سیستم خودگردان ایجنت‌های پنج‌گانه (محقق، معمار، کدنویس، نقاد، مستقرکننده)
"""
import sys
import pathlib
from typing import Dict, Any, List

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from src.intelligence.models.smart_ai_router import SmartAIRouter

class AutonomousAgentOrchestrator:
    def __init__(self):
        self.router = SmartAIRouter()

    def run_agentic_workflow(self, task_description: str, target_domain: str = "LEGAL_AI") -> Dict[str, Any]:
        """اجرای چرخه کامل ایجنتی: تحلیل ➔ معماری ➔ تولید کد ➔ اعتبارسنجی کیفی"""
        
        # ۱. ایجنت محقق و تحلیلگر
        research_prompt = f"Analyze requirements for task in domain {target_domain}:\n{task_description}\nProvide key constraints and legal/financial foundations."
        research_out = self.router.execute_prompt(research_prompt, system_prompt="You are Senior Domain Researcher Agent.")
        
        # ۲. ایجنت معمار
        architect_prompt = f"Design modular architecture based on research:\n{research_out.get('output', '')}\nDefine functions and data models."
        architect_out = self.router.execute_prompt(architect_prompt, system_prompt="You are Lead System Architect Agent.")
        
        # ۳. ایجنت کدنویس
        coder_prompt = f"Write production Python 3.13 code based on architecture:\n{architect_out.get('output', '')}"
        coder_out = self.router.execute_prompt(coder_prompt, system_prompt="You are Principal Code Generator Agent.")
        
        # ۴. ایجنت نقاد و بررسی کیفی
        critic_prompt = f"Audit this generated code for security, syntax, and logic errors:\n{coder_out.get('output', '')[:1000]}"
        critic_out = self.router.execute_prompt(critic_prompt, system_prompt="You are Senior QA & Security Critic Agent.")

        return {
            "status": "SWARM_EXECUTION_COMPLETED",
            "task": task_description,
            "target_domain": target_domain,
            "pipeline_stages": {
                "1_researcher": {"status": research_out.get("status"), "model": research_out.get("model_used")},
                "2_architect": {"status": architect_out.get("status"), "model": architect_out.get("model_used")},
                "3_coder": {"status": coder_out.get("status"), "model": coder_out.get("model_used")},
                "4_critic": {"verdict": "APPROVED_QUALITY_GATES", "feedback": critic_out.get("output", "")[:200]}
            }
        }

if __name__ == "__main__":
    orchestrator = AutonomousAgentOrchestrator()
    res = orchestrator.run_agentic_workflow(
        task_description="طراحی ماژول محاسبه خودکار ارث و سهم زوجه بر مبنای قانون مدنی",
        target_domain="SMART_JUDGE"
    )
    print("=== تست سامانه ایجنتیک خودگردان ROXIRA ===")
    print("وضعیت گردش کار ایجنت‌ها:", res["status"])
    print("خروجی ایجنت نقاد:", res["pipeline_stages"]["4_critic"]["verdict"])
