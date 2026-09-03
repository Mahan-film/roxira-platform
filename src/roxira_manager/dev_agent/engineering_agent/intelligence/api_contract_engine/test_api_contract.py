

from src.roxira_manager.dev_agent.engineering_agent.intelligence.api_contract_engine.api_contract_analyzer import APIContractAnalyzer



result = APIContractAnalyzer().analyze_class(

    "src/roxira_manager/legal_intelligence/judgment_simulation/evidence_weight.py",

    "EvidenceWeight"

)


print(result)

