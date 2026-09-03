

from src.roxira_manager.master_agent.v5.cognitive.reasoning_engine import CognitiveReasoning
from src.roxira_manager.master_agent.v5.knowledge.context_engine import ContextEngine
from src.roxira_manager.master_agent.v5.reflection.self_reflection import SelfReflection



context=ContextEngine().build(
"smart judge autonomous development"
)


print(context)



reasoning=CognitiveReasoning().analyze(
context
)


print(reasoning)



print(
SelfReflection().evaluate(
reasoning
)
)

