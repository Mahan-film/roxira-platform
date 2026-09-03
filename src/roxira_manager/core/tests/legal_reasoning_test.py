
from src.roxira_manager.agents.legal.legal_reasoning_agent import LegalReasoningAgent



agent = LegalReasoningAgent()


result = agent.analyze(

"""

خریدار ملک هستم.
فروشنده از انتقال سند رسمی خودداری می‌کند.
قرارداد عادی داریم.

"""

)


print(result)


