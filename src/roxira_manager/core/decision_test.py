
from src.roxira_manager.legal_engine.decision_pipeline import DecisionPipeline


pipeline = DecisionPipeline()


result = pipeline.analyze(

{
"category":"civil",
"description":
"الزام به تنظیم سند رسمی آپارتمان",
"amount":500000000
},


{
"sources":
{
"results":[]
}
}

)


print(result)

