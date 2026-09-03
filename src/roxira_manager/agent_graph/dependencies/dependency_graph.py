class DependencyGraph:


    def analyze(
        self,
        component
    ):

        return {

            "component":component,

            "dependencies":[],

            "status":"ANALYZED"

        }
