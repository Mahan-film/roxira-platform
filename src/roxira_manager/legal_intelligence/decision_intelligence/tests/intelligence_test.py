

from src.roxira_manager.legal_intelligence.decision_intelligence.authority_engine import AuthorityEngine
from src.roxira_manager.legal_intelligence.decision_intelligence.success_predictor import SuccessPredictor
from src.roxira_manager.legal_intelligence.decision_intelligence.action_planner import LegalActionPlanner



issues=[

"property_transaction",
"official_deed_transfer"

]


evidence=[

"مبایعه نامه",
"رسید پرداخت",
"گواهی عدم حضور"

]


sources=[

"ماده 219 قانون مدنی",
"رای وحدت رویه 805",
"تحلیل حقوقی"

]



print(
AuthorityEngine().rank(
sources
)
)



print(
SuccessPredictor().predict(
issues,
evidence
)
)



print(
LegalActionPlanner().plan(
issues
)
)


