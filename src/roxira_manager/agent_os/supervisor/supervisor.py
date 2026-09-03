

from src.roxira_manager.agent_os.agents.legal_agents import *


class AgentSupervisor:


    def __init__(self):

        self.agents={

            "case_analyzer":
            CaseAnalyzerAgent(),

            "legal_research":
            LegalResearchAgent(),

            "evidence":
            EvidenceAgent(),

            "drafting":
            DraftingAgent(),

            "critic":
            CriticAgent()

        }



    def select_agents(self,task):


        return list(self.agents.values())




    def execute(self,task):


        results=[]


        agents=self.select_agents(task)


        for agent in agents:

            results.append(

                agent.execute(task)

            )


        return {

            "task":task,

            "agents_executed":
            len(results),

            "results":results,

            "status":
            "MULTI_AGENT_COMPLETE"

        }

