from __future__ import annotations



class LegalValidator:


    def validate(self, document):


        errors=[]


        if not document.get("document"):
            errors.append(
                "Document empty"
            )


        if "status" not in document:
            errors.append(
                "Missing status"
            )


        return {

            "valid":
            len(errors)==0,

            "errors":
            errors

        }
