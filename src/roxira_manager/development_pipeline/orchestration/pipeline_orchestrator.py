class PipelineOrchestrator:


    def execute(self,project):

        return {

            "project":project,

            "stages":[

                "analysis",
                "architecture",
                "development",
                "testing",
                "deployment"

            ],

            "status":"PIPELINE_STARTED"

        }
