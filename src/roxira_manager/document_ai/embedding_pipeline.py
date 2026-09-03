

class EmbeddingPipeline:


    def create_record(
        self,
        chunk,
        metadata=None
    ):


        return {

            "text":chunk,

            "metadata":
            metadata or {},

            "status":
            "READY_FOR_VECTOR_INDEX"

        }


