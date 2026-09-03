from __future__ import annotations


class CitationEngine:


    def build(self, authorities):

        citations = []


        for item in authorities:

            citations.append(
                {
                    "title":
                    item.get("title"),

                    "category":
                    item.get("category"),

                    "reference":
                    f"استناد به {item.get('title')}"
                }
            )


        return citations
