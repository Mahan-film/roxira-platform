

from src.roxira_manager.dev_agent.contract_intelligence.contract_checker import ContractChecker

from src.roxira_manager.dev_agent.contract_intelligence.patch_advisor import PatchAdvisor



defined=[

"analyze"

]


used=[

"analysis"

]


result=ContractChecker().check(

defined,

used

)


print(result)


print(

PatchAdvisor().suggest(
result
)

)

