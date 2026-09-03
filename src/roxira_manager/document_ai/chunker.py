

class DocumentChunker:


    def split(
        self,
        text,
        size=500
    ):


        chunks=[]


        words=text.split()


        for i in range(
            0,
            len(words),
            size
        ):

            chunks.append(

                " ".join(
                    words[i:i+size]
                )

            )


        return chunks


