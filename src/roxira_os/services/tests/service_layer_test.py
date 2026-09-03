

from src.roxira_os.services.service_registry import ServiceRegistry
from src.roxira_os.services.agent_service import AgentService
from src.roxira_os.services.memory_service import MemoryService
from src.roxira_os.services.model_service import ModelService
from src.roxira_os.services.module_service import ModuleService



registry=ServiceRegistry()


agent=AgentService()
memory=MemoryService()
model=ModelService()
module=ModuleService()



registry.register(
"agents",
agent
)


registry.register(
"memory",
memory
)


registry.register(
"models",
model
)


registry.register(
"modules",
module
)



agent.register_agent(
"test_agent",
type(
"Agent",
(),
{
"execute":
lambda self,t:{
"task":t,
"status":"DONE"
}
}
)()
)



model.register(
"max",
{
"model":"deepseek/deepseek-reasoner",
"tokens":12000
}
)



module.register(
{
"name":"legal",
"version":"1.0"
}
)



print(
registry.list_services()
)


print(
agent.execute(
"test_agent",
"Analyze legal case"
)
)


print(
memory.store(
"legal knowledge"
)
)


print(
model.select("max")
)


print(
module.list_modules()
)

