

from src.roxira_manager.dev_agent.patch_engine.rename_engine import RenameEngine

from src.roxira_manager.dev_agent.patch_engine.diff_generator import DiffGenerator

from src.roxira_manager.dev_agent.patch_engine.patch_validator import PatchValidator

from src.roxira_manager.dev_agent.patch_engine.patch_memory import PatchMemory



patch = RenameEngine().generate(

    "analysis",

    "analyze"

)


print(patch)


print(

DiffGenerator().create(
    patch
)

)


print(

PatchValidator().validate(
    patch
)

)


print(

PatchMemory().store(
    patch
)

)

