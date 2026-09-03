class ScenarioManager:


    def create(
        self,
        name,
        parameters
    ):

        return {

            "scenario":name,

            "parameters":parameters,

            "status":"CREATED"

        }
