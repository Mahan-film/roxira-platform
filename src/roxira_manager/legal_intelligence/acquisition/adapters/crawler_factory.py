


from .crawl4ai_adapter import Crawl4AIAdapter
from .firecrawl_adapter import FirecrawlAdapter



class CrawlerFactory:



    @staticmethod
    def create(
        provider="crawl4ai"
    ):


        if provider=="crawl4ai":

            return Crawl4AIAdapter()


        if provider=="firecrawl":

            return FirecrawlAdapter()


        raise Exception(
            "Unknown crawler"
        )

