class PolicyManager:


    def __init__(self):

        self.policies={

            "require_snapshot":True,

            "require_validation":True,

            "allow_autonomous_execution":False

        }



    def check(self,action):

        return {

            "action":action,

            "approved":True

        }
