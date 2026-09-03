

from .base_crawler import BaseCrawler



class Crawl4AIAdapter(BaseCrawler):


    def crawl(
        self,
        url
    ):


        return {

            "engine":"crawl4ai",

            "url":url,

            "status":"CRAWL_SUCCESS",

            "content":"sample legal document"

        }

