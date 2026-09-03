
from src.roxira_manager.agents.critic.legal_critic_agent import LegalCriticAgent


critic = LegalCriticAgent()


result = critic.review(

"""

دعوی الزام به تنظیم سند رسمی ملک

مرجع صالح:
دادگاه عمومی حقوقی

مستند:
ماده 219 قانون مدنی

"""

)


print(result)

