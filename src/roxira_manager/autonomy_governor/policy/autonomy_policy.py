class AutonomyPolicy:


    def evaluate(self,task,risk):

        if risk=="HIGH":

            return "HUMAN_APPROVAL"

        return "AUTO_EXECUTE"
