

from src.roxira_manager.legal_intelligence.knowledge_brain.source_validator import SourceValidator
from src.roxira_manager.legal_intelligence.knowledge_brain.precedent_engine import PrecedentEngine
from src.roxira_manager.legal_intelligence.knowledge_brain.graph_connector import LegalGraphConnector
from src.roxira_manager.legal_intelligence.knowledge_brain.memory_sync import LegalMemorySync



docs=[

"ماده 219 قانون مدنی",
"رای وحدت رویه 805"

]


validated=SourceValidator().validate(docs)

print(validated)



precedent=PrecedentEngine().analyze(
"property"
)

print(precedent)



graph=LegalGraphConnector().search(
"الزام به تنظیم سند رسمی"
)

print(graph)



memory=LegalMemorySync().store(
graph["nodes"]
)

print(memory)

