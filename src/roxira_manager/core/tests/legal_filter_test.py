
from src.roxira_manager.knowledge.legal_relevance_filter import LegalRelevanceFilter


f = LegalRelevanceFilter()


docs = [

{"title":"ماده 362 قانون مدنی بیع ملک"},

{"title":"ماده 23 قانون چک"}

]


print(
    f.filter(
        "الزام به تنظیم سند رسمی ملک",
        docs
    )
)

