
class LegalDomainRouter:


    DOMAINS = {

        "civil": [
            "ملک",
            "قرارداد",
            "خرید",
            "فروش",
            "تعهد",
            "خسارت",
            "الزام"
        ],

        "criminal": [
            "کلاهبرداری",
            "سرقت",
            "جعل",
            "خیانت",
            "جرم"
        ],

        "family":[
            "مهریه",
            "طلاق",
            "نفقه",
            "حضانت"
        ],

        "commercial":[
            "چک",
            "شرکت",
            "تجارت"
        ]

    }



    def classify(self,text):

        result=[]


        for domain,keywords in self.DOMAINS.items():

            for word in keywords:

                if word in text:

                    result.append(domain)
                    break


        return list(set(result)) or ["general"]


