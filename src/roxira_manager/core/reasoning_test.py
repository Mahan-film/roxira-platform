
from src.roxira_manager.legal_engine.reasoning.reasoning_pipeline import (
    ReasoningPipeline
)



pipeline = ReasoningPipeline()


result = pipeline.execute(

{
"category":"civil",

"description":
"خریدار ملک هستم، فروشنده حاضر به تنظیم سند رسمی نیست و درخواست خسارت قرارداد دارم"
}

)


print(result)

