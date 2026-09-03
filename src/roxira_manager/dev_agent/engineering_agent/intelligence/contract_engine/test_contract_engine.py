

from src.roxira_manager.dev_agent.engineering_agent.intelligence.contract_engine.contract_matcher import ContractMatcher



result = ContractMatcher().compare(

    [
        "analyze",
        "validate",
        "calculate"
    ],

    "analysis"

)


print(result)

