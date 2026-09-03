class AgentFeedback:


    def record(
        self,
        agent,
        result
    ):

        return {

            "agent":agent,

            "result":result,

            "status":"RECORDED"

        }
