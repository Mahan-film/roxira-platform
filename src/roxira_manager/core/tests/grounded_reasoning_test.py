
from src.roxira_manager.agents.legal.legal_grounded_reasoning_agent import LegalGroundedReasoningAgent



agent = LegalGroundedReasoningAgent()



result = agent.analyze(

"""

الزام به تنظیم سند رسمی ملک
فروشنده از انتقال سند خودداری می‌کند
قرارداد عادی وجود دارد

"""

)


print(result)

