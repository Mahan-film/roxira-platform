from __future__ import annotations

import numpy as np
from sentence_transformers import SentenceTransformer

class TextEmbedder:
    """Local SentenceTransformer embedder generating 384-dimensional dense vectors."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(model_name)

    def embed(self, text: str) -> np.ndarray:
        return self.model.encode(text, convert_to_numpy=True)

if __name__ == "__main__":
    embedder = TextEmbedder()
    vec = embedder.embed("تست امبدینگ سیستم هوشمند")
    print(f"✅ TextEmbedder Ready | Vector Dimension: {len(vec)}")
