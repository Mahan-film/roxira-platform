

from src.roxira_manager.intelligence.retrieval.domain_filter import LegalDomainFilter



documents=[


{
"payload":{
"title":"ماده 362 قانون مدنی",
"category":"CIVIL"
}
},


{
"payload":{
"title":"ماده 23 قانون صدور چک",
"category":"COMMERCIAL"
}
},


{
"payload":{
"title":"قانون حمایت خانواده",
"category":"FAMILY"
}
}



]


filter_engine=LegalDomainFilter()


print(
filter_engine.filter_documents(
documents,
["civil"]
)
)


print(
filter_engine.filter_documents(
documents,
["commercial"]
)
)

