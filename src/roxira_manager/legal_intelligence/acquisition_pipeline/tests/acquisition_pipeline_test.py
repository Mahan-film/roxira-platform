

from src.roxira_manager.legal_intelligence.acquisition_pipeline.document_processor import LegalDocumentProcessor
from src.roxira_manager.legal_intelligence.acquisition_pipeline.legal_chunker import LegalChunker
from src.roxira_manager.legal_intelligence.acquisition_pipeline.metadata_extractor import MetadataExtractor
from src.roxira_manager.legal_intelligence.acquisition_pipeline.index_adapter import LegalIndexAdapter



document="""
ماده 219 قانون مدنی
تعهدات قراردادی لازم الاجرا است
"""


processed = LegalDocumentProcessor().process(
    document
)

print(processed)



chunks = LegalChunker().split(
    processed["normalized"]
)

print(chunks)



metadata = MetadataExtractor().extract(
    chunks["chunks"][0]
)

print(metadata)



index = LegalIndexAdapter().index(
    chunks["chunks"]
)

print(index)

