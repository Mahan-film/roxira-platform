"""
ROXIRA LEGAL DOMAIN FILTER

Filters irrelevant legal knowledge
before sending to LLM
"""


class LegalRelevanceFilter:


    DOMAIN_RULES = {


        "property": [
            "ملک",
            "سند",
            "بیع",
            "انتقال",
            "ثبت",
            "زمین",
            "خانه"
        ],


        "commercial": [
            "چک",
            "شرکت",
            "تجارت",
            "برات"
        ],


        "family": [
            "مهریه",
            "طلاق",
            "حضانت",
            "نفقه"
        ],


        "criminal": [
            "سرقت",
            "کلاهبرداری",
            "ضرب",
            "جرم"
        ]

    }



    def detect_domain(self, query):


        for domain, words in self.DOMAIN_RULES.items():

            for word in words:

                if word in query:

                    return domain


        return "general"



    def filter(self, query, documents):


        domain = self.detect_domain(query)


        filtered = []


        for doc in documents:


            text = str(doc)


            allowed_words = self.DOMAIN_RULES.get(
                domain,
                []
            )


            if any(
                w in text
                for w in allowed_words
            ):

                filtered.append(doc)


        return {

            "domain": domain,

            "documents": filtered

        }

