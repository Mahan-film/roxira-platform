from __future__ import annotations


from src.roxira_manager.connectors.legal.legal_intelligence_connector import (
    LegalIntelligenceConnector
)


class ToolRegistry:


    def __init__(self):

        self.tools = {
            "legal_case_analyzer":
                LegalIntelligenceConnector()
        }


    def get(self, name):

        return self.tools.get(name)
