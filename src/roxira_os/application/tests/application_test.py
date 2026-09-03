

from src.roxira_os.application.module_manager import ModuleManager
from src.roxira_os.application.dependency_manager import DependencyManager
from src.roxira_os.application.health_checker import HealthChecker
from src.roxira_os.application.version_manager import VersionManager



module={

"name":"legal",

"version":"1.0",

"dependencies":[
    "memory",
    "models"
]

}



manager=ModuleManager()


print(
manager.install(module)
)


print(
manager.enable(
"legal"
)
)



deps=DependencyManager()


print(
deps.check(
module,
[
"memory",
"models"
]
)
)



health=HealthChecker()


print(
health.check(
module
)
)



version=VersionManager()


print(
version.compare(
"1.0",
"1.1"
)
)

