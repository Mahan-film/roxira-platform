from __future__ import annotations

import psycopg
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from sentence_transformers import SentenceTransformer
from src.roxira_config import postgres_dsn


DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

COLLECTION = "roxira_legal_memory"


class LegalVectorIndexer:

    def __init__(self):

        self.qdrant = QdrantClient(
            host="localhost",
            port=6333
        )

        self.model = SentenceTransformer(
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        )


    def load_graph_nodes(self):

        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:

                cur.execute("""
                SELECT 
                node_id,
                title,
                content,
                category
                FROM graph_nodes
                WHERE category IN 
                ('CIVIL','PROCEDURE','COMMERCIAL');
                """)

                return cur.fetchall()


    def index(self):

        nodes = self.load_graph_nodes()

        points = []

        for idx,node in enumerate(nodes):

            node_id,title,content,category = node

            text = f"""
            {title}

            {content}

            دسته:
            {category}
            """

            vector = self.model.encode(text).tolist()


            points.append(
                PointStruct(
                    id=idx,
                    vector=vector,
                    payload={
                        "node_id":node_id,
                        "title":title,
                        "text":content,
                        "category":category
                    }
                )
            )


        self.qdrant.upsert(
            collection_name=COLLECTION,
            points=points
        )


        print(
            f"LEGAL VECTOR INDEX COMPLETE: {len(points)} documents"
        )



if __name__ == "__main__":

    LegalVectorIndexer().index()