


from .test_runner import TestRunner

from .git_manager import GitManager

from .rollback import RollbackManager



class AutonomousExecutor:


    def __init__(self):

        self.tests=TestRunner()

        self.git=GitManager()

        self.rollback=RollbackManager()



    def validate(self,test_command):


        result=self.tests.run(
            test_command
        )


        if result["success"]:


            self.git.commit(
                "ROXIRA autonomous successful change"
            )


            return {

                "status":
                "SUCCESS",

                "git":
                "COMMITTED"

            }


        else:


            self.rollback.restore()


            return {

                "status":
                "FAILED",

                "action":
                "ROLLBACK"

            }

