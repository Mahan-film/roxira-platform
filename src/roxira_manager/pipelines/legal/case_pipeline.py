from __future__ import annotations


from src.roxira_manager.agents.legal.legal_research_agent import (
    LegalResearchAgent
)


class CasePipeline:


    def __init__(self):

        self.research_agent = LegalResearchAgent()



    def execute(self, case):

        research = self.research_agent.research(case)


        return {
            "case_analysis": case,
            "legal_research": research,
            "pipeline_status": "READY"
        }
