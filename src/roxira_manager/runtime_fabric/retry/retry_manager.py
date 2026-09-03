class RetryManager:


    def retry(self,task,count=3):

        return {

            "task":task,

            "attempts":count,

            "status":"RETRY_READY"

        }
