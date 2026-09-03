

import threading
import time


class ResourceLock:


    def __init__(self):

        self.locked=set()



    def acquire(self,resource):

        if resource in self.locked:

            return False


        self.locked.add(resource)

        return True



    def release(self,resource):

        self.locked.discard(resource)



class SwarmExecutor:


    def __init__(self):

        self.lock=ResourceLock()



    def execute_agent(self,mission):


        resource=mission["name"]


        if not self.lock.acquire(resource):

            return {

                "mission":resource,

                "status":"WAITING_RESOURCE"

            }


        try:


            time.sleep(0.1)


            return {


                "mission":resource,

                "agent":mission["agent"],

                "priority":mission["priority"],

                "status":"EXECUTED"

            }


        finally:


            self.lock.release(resource)



    def execute_swarm(self,missions):


        results=[]


        threads=[]



        def worker(item):

            results.append(

                self.execute_agent(item)

            )



        for mission in missions:


            t=threading.Thread(

                target=worker,

                args=(mission,)

            )


            threads.append(t)

            t.start()



        for t in threads:

            t.join()



        return {


            "results":results,

            "count":len(results),

            "status":

            "SWARM_EXECUTED"

        }

