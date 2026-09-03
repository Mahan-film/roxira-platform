

from src.roxira_os.kernel.module_loader import ModuleLoader
from src.roxira_os.kernel.event_bus import EventBus
from src.roxira_os.kernel.service_registry import ServiceRegistry



kernel=ModuleLoader()

kernel.register(
type(
"FinanceModule",
(),
{"name":"finance"}
)()
)


print(kernel.available_modules())


bus=EventBus()


bus.subscribe(
"customer.created",
lambda x: "finance updated"
)


print(
bus.publish(
"customer.created",
{}
)
)


services=ServiceRegistry()

services.register(
"memory",
"Qdrant"
)


print(
services.get("memory")
)

