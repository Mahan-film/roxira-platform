

class LegalIssueExtractor:


    def extract(self,case):

        issues=[]


        if "ملک" in case:

            issues.append(
                "property_transaction"
            )


        if "سند" in case:

            issues.append(
                "official_deed_transfer"
            )


        return {

            "issues":issues,

            "status":"ISSUES_EXTRACTED"

        }

