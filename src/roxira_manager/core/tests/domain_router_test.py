

from src.roxira_manager.intelligence.domain_router.legal_domain_router import LegalDomainRouter


router = LegalDomainRouter()


cases=[

"الزام به تنظیم سند رسمی ملک",

"عدم پرداخت مهریه",

"چک برگشتی"

]


for c in cases:

    print(
        c,
        "=>",
        router.classify(c)
    )

