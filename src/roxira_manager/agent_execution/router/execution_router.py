class ExecutionRouter:


    def route(
        self,
        task_type
    ):

        mapping={

            "architecture":"opencode",

            "autonomous":"openhands",

            "patch":"aider"

        }


        return {

            "agent":
            mapping.get(
                task_type,
                "opencode"
            ),

            "status":"AGENT_SELECTED"

        }
