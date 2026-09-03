class GraphQuery:


    def find_agent(
        self,
        capability
    ):

        return {

            "capability":capability,

            "agents":[],

            "status":"QUERY_READY"

        }
