
class CitationMapper:

    def map(self, issues):

        citations=[]

        for issue in issues:

            if issue=="official_deed_transfer":
                citations.extend([
                    "ماده 219 قانون مدنی",
                    "ماده 220 قانون مدنی",
                    "قانون ثبت اسناد و املاک"
                ])

            if issue=="property_transaction":
                citations.append(
                    "ماده 362 قانون مدنی"
                )


        return {
            "citations":list(set(citations)),
            "status":"CITATIONS_READY"
        }

