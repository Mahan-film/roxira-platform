

class ContractChecker:


    def check(
        self,
        defined,
        used
    ):


        missing=[]


        for method in used:

            if method not in defined:

                missing.append(
                    method
                )


        return {

            "missing":
            list(set(missing)),

            "valid":
            len(missing)==0

        }

