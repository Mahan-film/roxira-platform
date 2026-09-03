from __future__ import annotations



class TemplateEngine:


    def petition_template(
        self,
        case,
        citations,
        evidence
    ):


        return {

            "title":
            "دادخواست",

            "subject":
            case.get("description"),


            "sections":[

                {
                "name":"شرح دادخواست",
                "content":
                "شرح وقایع پرونده توسط خواهان"
                },


                {
                "name":"دلایل و مستندات",
                "content": evidence
                },


                {
                "name":"مستندات قانونی",
                "content": citations
                }

            ]
        }
