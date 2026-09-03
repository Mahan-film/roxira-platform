

from src.roxira_manager.platform.component_registry import ComponentRegistry
from src.roxira_manager.platform.system_map import SYSTEM_MAP



registry=ComponentRegistry()


for key,value in SYSTEM_MAP.items():

    registry.register(
        key,
        value
    )


print(
registry.list_components()
)


print(SYSTEM_MAP)

