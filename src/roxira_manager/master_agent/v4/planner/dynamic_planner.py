

class DynamicPlanner:


    def plan(self,task,agents):

        steps=[]


        for agent in agents:

            steps.append({

                "agent":agent,

                "action":"EXECUTE"

            })


        return {

            "task":task,

            "plan":steps,

            "status":"DYNAMIC_PLAN_READY"

        }

