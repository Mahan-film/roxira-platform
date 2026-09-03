

class LegalDomainFilter:


    def filter_documents(self, documents, domains):

        filtered=[]


        for doc in documents:

            category = (
                doc.get("payload",{})
                .get("category","")
                .lower()
            )


            if not domains:
                filtered.append(doc)
                continue


            for domain in domains:

                if domain in category.lower():

                    filtered.append(doc)
                    break


        return filtered


