

from src.roxira_manager.legal_engine.drafting.document_builder import (
    DocumentBuilder
)

from src.roxira_manager.legal_engine.validation.legal_validator import (
    LegalValidator
)



case = {

"category":"civil",

"description":
"الزام به تنظیم سند رسمی ملک"

}



authorities = [

{
"title":
"ماده ۲۲۰ قانون مدنی",

"category":
"CIVIL"
},

{
"title":
"رای وحدت رویه ۸۰۵",

"category":
"PRECEDENT"
}

]



evidence = [

"مبایعه نامه",

"رسید پرداخت",

"گواهی عدم حضور دفترخانه"

]



builder = DocumentBuilder()


document = builder.build(
    case,
    authorities,
    evidence
)



validator = LegalValidator()


result = validator.validate(
    document
)


print(document)

print(result)

