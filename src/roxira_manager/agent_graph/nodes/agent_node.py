class AgentNode:


    def create(
        self,
        agent_id,
        role,
        capabilities
    ):

        return {

            "id":agent_id,

            "role":role,

            "capabilities":capabilities,

            "type":"AGENT_NODE"

        }
