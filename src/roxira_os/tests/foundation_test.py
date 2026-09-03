

from src.roxira_os.core.runtime import ROXIRARuntime
from src.roxira_os.models.router import ModelRouter
from src.roxira_os.memory.memory import ROXIRAMemory
from src.roxira_os.security.audit import AuditLogger



class TestAgent:


    name="test_agent"



    def execute(self,task,context):

        return {

            "agent":self.name,

            "task":task,

            "status":"DONE"

        }




runtime=ROXIRARuntime()

state=runtime.create_state(

"ساخت سیستم هوش مصنوعی شخصی"

)


result=runtime.execute(

state,

[TestAgent()]

)


print(result.history)

print(

ModelRouter().select("max")

)


memory=ROXIRAMemory()

print(memory.store(result.history))


audit=AuditLogger()

audit.write("SYSTEM_READY")

print(audit.all())

