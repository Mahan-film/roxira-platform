

from src.roxira_manager.document_ai.file_detector import FileDetector

from src.roxira_manager.document_ai.text_normalizer import MarkdownNormalizer

from src.roxira_manager.document_ai.chunker import DocumentChunker

from src.roxira_manager.document_ai.embedding_pipeline import EmbeddingPipeline

from src.roxira_manager.document_ai.voice_processor import PersianVoiceProcessor



detector=FileDetector()

print(
detector.detect(
"contract.pdf"
)
)



normalizer=MarkdownNormalizer()

doc=normalizer.convert(
"مبایعه نامه فروش ملک"
)

print(doc)



chunker=DocumentChunker()

chunks=chunker.split(
doc["content"]
)

print(chunks)



embed=EmbeddingPipeline()

print(
embed.create_record(
chunks[0],
{
"type":"legal_contract"
}
)
)



voice=PersianVoiceProcessor()

print(
voice.prepare_audio(
"voice_message.mp3"
)
)


