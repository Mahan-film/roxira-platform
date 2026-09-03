


from .source_registry import LegalSourceRegistry
from .document_fetcher import LegalDocumentFetcher



class LegalCrawler:



    def __init__(self):

        self.registry=LegalSourceRegistry()

        self.fetcher=LegalDocumentFetcher()



    def crawl_sources(self):


        results=[]


        for key in self.registry.list_sources():

            results.append(

                self.fetcher.fetch(key)

            )


        return {

            "sources_scanned":
            len(results),

            "results":
            results,

            "status":
            "CRAWLER_READY"

        }

