

from src.roxira_manager.reasoning_ai.reasoning_agent import (
    ReasoningAgent
)



agent = ReasoningAgent()


result = agent.execute(

{
"issue":
"عدم انتقال سند رسمی ملک"
},

{
"action":
"الزام به تنظیم سند رسمی"
},

"pro"

)


print(result)

