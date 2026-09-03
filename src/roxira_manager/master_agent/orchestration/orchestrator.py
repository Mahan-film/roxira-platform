

from src.roxira_manager.master_agent.runtime.agent_executor import AgentExecutor
from src.roxira_manager.master_agent.tool_registry.registry import ToolRegistry
from src.roxira_manager.master_agent.feedback.feedback_loop import FeedbackLoop



class MasterOrchestrator:


    def __init__(self):

        self.executor=AgentExecutor()
        self.tools=ToolRegistry()
        self.feedback=FeedbackLoop()



    def run(self,task,domain):


        tools=self.tools.select(domain)


        execution=self.executor.run(
            task,
            domain
        )


        feedback=self.feedback.evaluate(
            execution
        )


        return {

            "tools":tools,

            "execution":execution,

            "feedback":feedback,

            "status":"MASTER_ORCHESTRATION_READY"

        }

