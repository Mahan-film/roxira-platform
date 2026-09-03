

from src.roxira_manager.legal_intelligence.knowledge_pipeline.legal_document_schema import LegalDocumentSchema

from src.roxira_manager.legal_intelligence.knowledge_pipeline.legal_chunker import LegalChunker

from src.roxira_manager.legal_intelligence.knowledge_pipeline.legal_indexer import LegalIndexer

from src.roxira_manager.legal_intelligence.knowledge_pipeline.legal_graph_builder import LegalGraphBuilder



document = LegalDocumentSchema().create(

    "قانون مدنی ماده 219",

    "official_source",

    "civil",

    "تعهدات قراردادی لازم الاجرا است"

)


chunks = LegalChunker().chunk(document)


print(document)

print(chunks)


print(

LegalIndexer().index(chunks)

)


print(

LegalGraphBuilder().build(document)

)


