

class ExecutionPolicy:


    def check(self,agent,task_type):


        rules={

            "BUG_FIX":True,

            "REFACTOR":True,

            "FEATURE":False,

            "ARCHITECTURE":False,

            "SECURITY":False

        }


        return {

            "agent":agent,

            "task_type":task_type,

            "allowed":rules.get(task_type,False),

            "status":"POLICY_CHECKED"

        }

