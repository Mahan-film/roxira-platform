

from src.roxira_manager.master_agent.v4.swarm.agent_swarm import AgentSwarm
from src.roxira_manager.master_agent.v5.cognitive.reasoning_engine import CognitiveReasoning
from src.roxira_manager.master_agent.v5.knowledge.context_engine import ContextEngine



class NeuralOrchestrator:


    def __init__(self):

        self.swarm=AgentSwarm()

        self.context=ContextEngine()

        self.reasoner=CognitiveReasoning()



    def run(self,task,domain):


        context=self.context.build(task)


        reasoning=self.reasoner.analyze(
            context
        )


        swarm=self.swarm.spawn(
            task,
            domain
        )


        return {

            "context":context,

            "reasoning":reasoning,

            "swarm":swarm,

            "status":"NEURAL_ORCHESTRATION_READY"

        }


