

import concurrent.futures



class TaskQueue:


    def run(self,tasks):


        def execute(task):

            return {

                "task":task,

                "status":"DONE"

            }


        with concurrent.futures.ThreadPoolExecutor() as executor:

            results=list(
                executor.map(
                    execute,
                    tasks
                )
            )


        return {

            "results":results,

            "status":"PARALLEL_QUEUE_COMPLETE"

        }

