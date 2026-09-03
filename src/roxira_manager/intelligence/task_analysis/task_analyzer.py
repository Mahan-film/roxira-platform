class TaskAnalyzer:


    def analyze(self, task):

        return {

            "task": task,

            "required_capabilities":
            self.detect(task)

        }


    def detect(self,task):

        task = task.lower()

        capabilities=[]


        if "code" in task or "repair" in task:

            capabilities.append(
                "code_edit"
            )


        if "test" in task:

            capabilities.append(
                "testing"
            )


        if "research" in task:

            capabilities.append(
                "research"
            )


        return capabilities
