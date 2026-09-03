class SwarmScheduler:


    def schedule(self,tasks,workers):

        assignments=[]


        for index,task in enumerate(tasks):

            worker=workers[
                index % len(workers)
            ]


            assignments.append(
                worker.assign(task)
            )


        return assignments
