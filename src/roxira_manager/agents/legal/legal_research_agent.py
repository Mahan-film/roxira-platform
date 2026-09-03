from __future__ import annotations

from src.roxira_manager.connectors.graphrag.legal_memory_connector import (
    LegalMemoryConnector
)


class LegalResearchAgent:


    def __init__(self):

        self.memory = LegalMemoryConnector()


    def research(self, case):

        query = case.get("description", "")

        legal_sources = self.memory.search(query)


        return {
            "agent": "legal_research",
            "case": case,
            "sources": legal_sources,
            "status": "COMPLETED"
        }
