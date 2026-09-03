class CognitiveController:


    def process(self,mission):

        return {

            "mission":mission,

            "pipeline":[

                "PERCEPTION",

                "CONTEXT",

                "REASONING",

                "PLANNING",

                "EXECUTION",

                "EVALUATION",

                "LEARNING"

            ],

            "status":"COGNITIVE_FLOW_READY"

        }
