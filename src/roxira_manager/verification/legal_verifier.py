"""
ROXIRA LEGAL VERIFICATION ENGINE v2

Supports:
- GraphRAG dict results
- string knowledge results
- citation checking
"""


class LegalVerifier:


    def verify(self, response, knowledge=None):


        errors = []
        warnings = []


        text = response.get(
            "output",
            ""
        )


        knowledge_titles = []


        if knowledge:

            for item in knowledge:

                if isinstance(item, dict):

                    title = item.get(
                        "title"
                    )

                    if title:
                        knowledge_titles.append(title)


                elif isinstance(item, str):

                    knowledge_titles.append(
                        item
                    )


        if "ماده" in text or "رای" in text:

            if not knowledge_titles:

                warnings.append(
                    "No grounded legal citation detected"
                )


        confidence = 0.9

        if warnings:

            confidence = 0.65


        return {

            "verified":
                len(errors)==0,

            "errors":
                errors,

            "warnings":
                warnings,

            "knowledge_sources_checked":
                len(knowledge_titles),

            "confidence":
                confidence

        }

