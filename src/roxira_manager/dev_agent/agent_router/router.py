

class AgentRouter:


    def select(self, task):


        task_lower = task.lower()


        if any(
            word in task_lower
            for word in [
                "bug",
                "fix",
                "patch",
                "error"
            ]
        ):

            return {

                "agent":"aider",

                "reason":
                "small_change"

            }



        if any(
            word in task_lower
            for word in [
                "architecture",
                "module",
                "refactor",
                "migration"
            ]
        ):

            return {

                "agent":"openhands",

                "reason":
                "large_change"

            }



        return {


            "agent":"opencode",

            "reason":
            "general_development"

        }

