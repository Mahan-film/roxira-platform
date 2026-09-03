class StateQuery:


    def search(
        self,
        query
    ):

        return {

            "query":query,

            "results":[],

            "status":"QUERY_READY"

        }
