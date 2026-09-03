

from src.roxira_manager.modules.registry import ModuleRegistry
from src.roxira_manager.modules.module_contract import ModuleContract



class LegalModule(ModuleContract):

    name="legal"



class FinanceModule(ModuleContract):

    name="finance"



registry=ModuleRegistry()


registry.register(LegalModule())

registry.register(FinanceModule())


print(
registry.list()
)


print(
registry.get("legal").memory_namespace()
)

