

from .base_crawler import BaseCrawler



class FirecrawlAdapter(BaseCrawler):


    def crawl(
        self,
        url
    ):


        return {

            "engine":"firecrawl",

            "url":url,

            "status":"BACKUP_READY"

        }

