from __future__ import annotations


from .template_engine import TemplateEngine
from .citation_engine import CitationEngine



class DocumentBuilder:


    def __init__(self):

        self.template = TemplateEngine()

        self.citation = CitationEngine()



    def build(
        self,
        case,
        authorities,
        evidence
    ):


        citations = self.citation.build(
            authorities
        )


        document = self.template.petition_template(
            case,
            citations,
            evidence
        )


        return {

            "document":
            document,

            "status":
            "DOCUMENT_READY"

        }
