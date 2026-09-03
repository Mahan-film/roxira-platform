

class LegalStrategyEngine:


    def generate(self,issues):


        strategy=[]


        if "official_deed_transfer" in issues:

            strategy.append(
                "obligation_to_transfer_official_deed"
            )


        if "property_transaction" in issues:

            strategy.append(
                "review_sale_contract"
            )


        return {

            "strategy":strategy,

            "status":"STRATEGY_READY"

        }

