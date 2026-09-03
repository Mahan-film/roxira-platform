

class LegalChunker:


    def chunk(self, document):

        text=document["content"]

        chunks=[]

        size=500


        for i in range(0,len(text),size):

            chunks.append({

                "chunk_id":i,

                "text":text[i:i+size],

                "document":document["title"]

            })


        return chunks


