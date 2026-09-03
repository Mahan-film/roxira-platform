class PipelineStage:


    def run(self,name,data):

        return {

            "stage":name,

            "input":data,

            "status":"COMPLETED"

        }
