

class IssueExtractor:


    def extract(self,report):

        issues=[]


        keywords={

            "SmartJudgeEngine":"CREATE_ENGINE",

            "GraphRAG":"FIX_GRAPHRAG",

            "Gateway":"CONNECT_AI"

        }


        for key,value in keywords.items():

            if key in report:

                issues.append({

                    "issue":key,

                    "action":value

                })


        return {

            "issues":issues,

            "count":len(issues),

            "status":"ISSUES_EXTRACTED"

        }

