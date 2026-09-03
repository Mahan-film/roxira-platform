

from src.roxira_manager.legal_intelligence.acquisition.adapters.crawler_factory import CrawlerFactory



crawler=CrawlerFactory.create(
"crawl4ai"
)


print(
crawler.crawl(
"https://official-law-source.ir"
)
)



backup=CrawlerFactory.create(
"firecrawl"
)


print(
backup.crawl(
"https://official-law-source.ir"
)
)

