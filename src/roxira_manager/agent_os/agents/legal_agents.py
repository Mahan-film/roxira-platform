

from .base_agent import BaseAgent



class CaseAnalyzerAgent(BaseAgent):

    name="case_analyzer"

    capabilities=[
        "classification",
        "issue_detection"
    ]



class LegalResearchAgent(BaseAgent):

    name="legal_research"

    capabilities=[
        "law_search",
        "precedent_search"
    ]



class EvidenceAgent(BaseAgent):

    name="evidence_agent"

    capabilities=[
        "evidence_analysis"
    ]



class DraftingAgent(BaseAgent):

    name="legal_drafting"

    capabilities=[
        "document_generation"
    ]



class CriticAgent(BaseAgent):

    name="critic"

    capabilities=[
        "answer_verification"
    ]

