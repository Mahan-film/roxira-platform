

from src.roxira_manager.legal_intelligence.smart_judge_orchestrator.orchestrator import SmartJudgeOrchestrator



class MockReasoning:


    def analyze(self, case):

        return {

            "issue":
            "official_deed_transfer"

        }



class MockDecision:


    def predict(self, analysis):

        return {

            "probability":90

        }




components={

"reasoning":
MockReasoning(),

"decision":
MockDecision()

}



case="""
خریدار ملک هستم
فروشنده سند نمی زند
"""



result = SmartJudgeOrchestrator().execute(
    case,
    components
)


print(result)

