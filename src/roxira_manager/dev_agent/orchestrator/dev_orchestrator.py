

from src.roxira_manager.dev_agent.agent_router.router import AgentRouter

from src.roxira_manager.dev_agent.external_agents.aider_adapter import AiderAgent
from src.roxira_manager.dev_agent.external_agents.openhands_adapter import OpenHandsAgent
from src.roxira_manager.dev_agent.external_agents.opencode_adapter import OpenCodeAgent



class DevOrchestrator:


    def __init__(self):

        self.router=AgentRouter()


        self.agents={

            "aider":
            AiderAgent(),

            "openhands":
            OpenHandsAgent(),

            "opencode":
            OpenCodeAgent()

        }



    def execute(self,task):


        decision=self.router.select(task)


        agent_name=decision["agent"]


        result=self.agents[agent_name].execute(task)


        return {


            "task":task,

            "selected_agent":
            agent_name,


            "decision":
            decision,


            "execution":
            result,


            "status":
            "ORCHESTRATION_READY"

        }

