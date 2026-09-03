
from src.roxira_manager.pipelines.legal.full_case_pipeline import FullLegalCasePipeline



pipeline = FullLegalCasePipeline()



result = pipeline.run(

"""

خریدار ملک هستم.
مبایعه نامه عادی دارم.
فروشنده حاضر به تنظیم سند رسمی نیست.
همچنین احتمال کلاهبرداری وجود دارد.

"""

)



print(result)

