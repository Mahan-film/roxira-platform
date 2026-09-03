

import concurrent.futures



class ParallelExecutor:


    def execute(self,tasks):

        results=[]


        def run(task):

            return {
                "task":task,
                "status":"EXECUTED"
            }


        with concurrent.futures.ThreadPoolExecutor() as executor:

            results=list(
                executor.map(run,tasks)
            )


        return {
            "results":results,
            "count":len(results),
            "status":"PARALLEL_EXECUTION_READY"
        }

