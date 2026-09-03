class AutonomyPolicy:


    def __init__(self):

        self.rules={

            "allow_auto_patch":True,

            "require_validation":True,

            "require_snapshot":True

        }



    def check(self):

        return self.rules
