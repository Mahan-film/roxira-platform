from src.roxira_manager.pipelines.legal.case_pipeline import CasePipeline


pipeline = CasePipeline()


result = pipeline.execute(
    {
        "category": "civil",
        "description":
        "الزام به تنظیم سند رسمی ملک و مطالبه خسارت قرارداد"
    }
)


print(result)
