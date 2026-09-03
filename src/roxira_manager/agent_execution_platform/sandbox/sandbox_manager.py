class SandboxManager:


    def create(self,task):

        return {

            "sandbox":True,

            "task":task,

            "status":"CREATED"

        }


    def destroy(self):

        return True
