
from datetime import datetime


class KnowledgeVersionManager:


    def create_version(self, document):


        return {

            "document": document,

            "version": "1.0",

            "created":
                datetime.now().isoformat(),

            "status":
                "VERSION_CREATED"

        }

