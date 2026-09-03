
from src.roxira_manager.agents.critic.grounded_legal_critic_agent import GroundedLegalCriticAgent


critic = GroundedLegalCriticAgent()


result = critic.review(

"""
دعوی الزام به تنظیم سند رسمی ملک

استناد:
ماده 219 قانون مدنی

مرجع:
دادگاه عمومی حقوقی

""",

"""

خریدار ملک هستم.
فروشنده سند رسمی انتقال نمی‌دهد.

"""

)


print(result)

